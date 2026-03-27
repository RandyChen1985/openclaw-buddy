package process

import (
	"sort"
	"sync"
	"time"
)

type TaskStatus string

const (
	TaskStatusRunning   TaskStatus = "Running"
	TaskStatusCompleted TaskStatus = "Completed"
	TaskStatusFailed    TaskStatus = "Failed"
)

type Task struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Status    TaskStatus `json:"status"`
	StartTime time.Time  `json:"startTime"`
	EndTime   *time.Time `json:"endTime,omitempty"`
	Error     string     `json:"error,omitempty"`
}

var (
	tasks = make(map[string]*Task)
	mu    sync.RWMutex
)

// RegisterTask 注册一个新任务
func RegisterTask(id, name string) {
	mu.Lock()
	defer mu.Unlock()
	
	// 如果任务数过多，清理超过 1 小时的完成任务
	if len(tasks) > 100 {
		for k, t := range tasks {
			if t.Status != TaskStatusRunning && time.Since(t.StartTime) > time.Hour {
				delete(tasks, k)
			}
		}
	}

	tasks[id] = &Task{
		ID:        id,
		Name:      name,
		Status:    TaskStatusRunning,
		StartTime: time.Now(),
	}
}

// UpdateTaskStatus 更新任务状态
func UpdateTaskStatus(id string, status TaskStatus, err string) {
	mu.Lock()
	defer mu.Unlock()
	if t, ok := tasks[id]; ok {
		t.Status = status
		t.Error = err
		now := time.Now()
		t.EndTime = &now
	}
}

// GetTask 获取指定任务
func GetTask(id string) (*Task, bool) {
	mu.RLock()
	defer mu.RUnlock()
	t, ok := tasks[id]
	return t, ok
}

// GetAllTasks 获取所有任务，按时间倒序排列
func GetAllTasks() []*Task {
	mu.RLock()
	defer mu.RUnlock()
	
	all := make([]*Task, 0, len(tasks))
	for _, t := range tasks {
		all = append(all, t)
	}
	
	sort.Slice(all, func(i, j int) bool {
		return all[i].StartTime.After(all[j].StartTime)
	})
	
	return all
}
