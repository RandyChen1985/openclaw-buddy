package process

import (
	"database/sql"
	"fmt"
	"log"
	"sort"
	"sync"
	"time"
	"openclaw-buddy/internal/utils"
)

type TaskStatus string

const (
	TaskStatusRunning     TaskStatus = "Running"
	TaskStatusCompleted   TaskStatus = "Completed"
	TaskStatusFailed      TaskStatus = "Failed"
	TaskStatusTimeout     TaskStatus = "Timeout"
	TaskStatusInterrupted TaskStatus = "Interrupted"
)

type Task struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Module    string     `json:"module"`
	Action    string     `json:"action"`
	Target    string     `json:"target"`
	Command   string     `json:"command,omitempty"`
	Status    TaskStatus `json:"status"`
	Progress  int        `json:"progress"`
	Payload   string     `json:"payload,omitempty"`
	Result    string     `json:"result,omitempty"`
	Error     string     `json:"error,omitempty"`
	StartTime time.Time  `json:"startTime"`
	EndTime   *time.Time `json:"endTime,omitempty"`
}

var (
	tasks          = make(map[string]*Task)
	mu             sync.RWMutex
	moduleLocks    = make(map[string]bool)
	lockMu         sync.Mutex
	TaskUpdateChan = make(chan *Task, 100)
)

// RegisterTask 注册一个新任务
func RegisterTask(t *Task) error {
	mu.Lock()
	defer mu.Unlock()

	// 自动清理内存：保留 50 条活跃或最近的任务
	if len(tasks) > 50 {
		for id, task := range tasks {
			if task.Status != TaskStatusRunning && time.Since(task.StartTime) > 30*time.Minute {
				delete(tasks, id)
			}
		}
	}

	t.Status = TaskStatusRunning
	t.StartTime = time.Now()
	if t.Progress == 0 {
		t.Progress = 0
	}
	tasks[t.ID] = t

	// 触发实时推送
	select {
	case TaskUpdateChan <- t:
	default:
	}

	// 持久化到数据库
	if utils.DB != nil {
		_, err := utils.DB.Exec(`
			INSERT INTO tasks (id, name, module, action, target, command, status, progress, payload, start_time)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			t.ID, t.Name, t.Module, t.Action, t.Target, t.Command, t.Status, t.Progress, t.Payload, t.StartTime)
		if err != nil {
			return fmt.Errorf("failed to persist task to db: %v", err)
		}
	}

	return nil
}

// UpdateTaskProgress 更新任务进度
func UpdateTaskProgress(id string, progress int) {
	mu.Lock()
	defer mu.Unlock()

	if t, ok := tasks[id]; ok {
		t.Progress = progress
		
		select {
		case TaskUpdateChan <- t:
		default:
		}

		if utils.DB != nil {
			_, _ = utils.DB.Exec("UPDATE tasks SET progress = ? WHERE id = ?", progress, id)
		}
	}
}

// UpdateTaskStatus 更新任务状态
func UpdateTaskStatus(id string, status TaskStatus, result string, errStr string) {
	mu.Lock()
	defer mu.Unlock()

	if t, ok := tasks[id]; ok {
		t.Status = status
		t.Result = result
		t.Error = errStr
		now := time.Now()
		t.EndTime = &now

		select {
		case TaskUpdateChan <- t:
		default:
		}

		if utils.DB != nil {
			_, _ = utils.DB.Exec("UPDATE tasks SET status = ?, result = ?, error = ?, end_time = ? WHERE id = ?",
				status, result, errStr, now, id)
		}
	}
}

// LockModule 尝试锁定模块
func LockModule(module string) bool {
	lockMu.Lock()
	defer lockMu.Unlock()
	if moduleLocks[module] {
		return false
	}
	moduleLocks[module] = true
	return true
}

// UnlockModule 释放模块锁
func UnlockModule(module string) {
	lockMu.Lock()
	defer lockMu.Unlock()
	delete(moduleLocks, module)
}

// IsModuleLocked 检查模块是否被锁定
func IsModuleLocked(module string) bool {
	lockMu.Lock()
	defer lockMu.Unlock()
	return moduleLocks[module]
}

// CleanupOrphanedTasks 清理孤儿任务
func CleanupOrphanedTasks() {
	if utils.DB == nil {
		return
	}
	log.Println("🧹 [Task] 正在清理孤儿任务...")
	_, err := utils.DB.Exec("UPDATE tasks SET status = ?, error = 'System Interrupted' WHERE status = ?",
		TaskStatusInterrupted, TaskStatusRunning)
	if err != nil {
		log.Printf("❌ [Task] 清理孤儿任务失败: %v", err)
	}
}

// GetTask 获取指定任务
func GetTask(id string) (*Task, bool) {
	mu.RLock()
	defer mu.RUnlock()
	t, ok := tasks[id]
	return t, ok
}

// GetAllTasks 获取所有任务（结合内存活跃任务与数据库历史）
func GetAllTasks() []*Task {
	mu.Lock()
	defer mu.Unlock()

	all := make([]*Task, 0, len(tasks))
	for _, t := range tasks {
		all = append(all, t)
	}

	// 无论内存有多少，始终尝试从数据库加载最近的 20 条历史记录进行合并
	if utils.DB != nil {
		rows, err := utils.DB.Query(`
			SELECT id, name, module, action, target, command, status, progress, result, error, start_time, end_time 
			FROM tasks 
			ORDER BY start_time DESC LIMIT 20`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var t Task
				var endTime sql.NullTime
				err := rows.Scan(&t.ID, &t.Name, &t.Module, &t.Action, &t.Target, &t.Command, &t.Status, &t.Progress, &t.Result, &t.Error, &t.StartTime, &endTime)
				if err != nil {
					continue
				}
				if endTime.Valid {
					t.EndTime = &endTime.Time
				}
				
				// 去重：如果内存里已经有了（可能是正在运行的），就不要用数据库里的老数据覆盖
				if _, exists := tasks[t.ID]; !exists {
					all = append(all, &t)
				}
			}
		}
	}

	sort.Slice(all, func(i, j int) bool {
		return all[i].StartTime.After(all[j].StartTime)
	})

	return all
}
