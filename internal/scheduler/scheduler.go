package scheduler

import (
	"log"
	"openclaw-buddy/internal/process"
	"sync"
	"time"
)

type Priority int

const (
	PriorityNormal Priority = iota
	PriorityHigh
)

type TaskRequest struct {
	Task     *process.Task
	Execute  func() (string, error)
	Priority Priority
}

type Scheduler struct {
	highQueue   chan TaskRequest
	normalQueue chan TaskRequest
	stopChan    chan struct{}
	mu          sync.RWMutex
	moduleStats map[string]int // module -> pending/active count
	activeTask  *process.Task  // 当前正在执行的任务
}

var (
	instance *Scheduler
	once     sync.Once
)

// GetScheduler 获取全局任务调度器
func GetScheduler() *Scheduler {
	once.Do(func() {
		instance = &Scheduler{
			highQueue:   make(chan TaskRequest, 100),
			normalQueue: make(chan TaskRequest, 200),
			stopChan:    make(chan struct{}),
			moduleStats: make(map[string]int),
		}
		go instance.start()
	})
	return instance
}

func (s *Scheduler) Submit(req TaskRequest) {
	s.mu.Lock()
	s.moduleStats[req.Task.Module]++
	s.mu.Unlock()

	if req.Priority == PriorityHigh {
		s.highQueue <- req
	} else {
		s.normalQueue <- req
	}
}

// IsModuleBusy 检查模块是否有排队或正在执行的任务 (供 Guardian 自愈避让)
func (s *Scheduler) IsModuleBusy(module string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.moduleStats[module] > 0
}

func (s *Scheduler) start() {
	log.Println("🚀 [Scheduler] 任务调度中心(串行模式)已启动，等待提交回调...")
	for {
		select {
		case req := <-s.highQueue:
			s.run(req)
		case <-s.stopChan:
			return
		default:
			// 优先读取高优队列，若为空才读取普通队列
			select {
			case req := <-s.highQueue:
				s.run(req)
			case req := <-s.normalQueue:
				s.run(req)
			case <-s.stopChan:
				return
			case <-time.After(1 * time.Second):
				// 空闲轮询
			}
		}
	}
}

func (s *Scheduler) run(req TaskRequest) {
	s.mu.Lock()
	s.activeTask = req.Task
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.moduleStats[req.Task.Module]--
		s.activeTask = nil
		s.mu.Unlock()
		process.UnlockModule(req.Task.Module) // 保持对旧锁机制的兼容性
	}()

	// 在物理执行前，确保旧锁机制能标记为锁定态 (兼容其他零散代码)
	process.LockModule(req.Task.Module)

	// 正式执行闭包逻辑
	done := make(chan struct{})
	var result string
	var err error

	go func() {
		log.Printf("🧵 [Scheduler] 正在串行执行任务: %s (Priority: %v)", req.Task.Name, req.Priority)
		result, err = req.Execute()
		close(done)
	}()

	// 任务执行超时保护 (遵循原有的 3 分钟限制)
	select {
	case <-done:
		if err != nil {
			log.Printf("❌ [Scheduler] 任务失败: %s, Error: %v", req.Task.Name, err)
			process.UpdateTaskStatus(req.Task.ID, process.TaskStatusFailed, "", err.Error())
		} else {
			log.Printf("✅ [Scheduler] 任务完成: %s, Result: %s", req.Task.Name, result)
			process.UpdateTaskStatus(req.Task.ID, process.TaskStatusCompleted, result, "")
		}
	case <-time.After(3 * time.Minute):
		log.Printf("⏰ [Scheduler] 任务超时: %s", req.Task.Name)
		process.UpdateTaskStatus(req.Task.ID, process.TaskStatusTimeout, "", "任务执行超时 (3分钟)")
	}
}
