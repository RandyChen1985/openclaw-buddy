package api

import (
	"context"
	"net/http"

	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/scheduler"

	"github.com/gin-gonic/gin"
)

// APIResponse 统一业务响应格式
type APIResponse struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// Success 返回标准成功响应
func (s *Server) Success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, APIResponse{
		Code:    200,
		Message: "success",
		Data:    data,
	})
}

// Error 返回标准错误响应
func (s *Server) Error(c *gin.Context, httpStatus int, msg string) {
	c.JSON(httpStatus, APIResponse{
		Code:    httpStatus,
		Message: msg,
	})
}

func (s *Server) handleGetTicket(c *gin.Context) {
	p := GetPrincipal(c)
	if p == nil {
		s.Error(c, http.StatusUnauthorized, "Unauthorized")
		return
	}
	ticket := s.tickets.Generate(p)
	s.Success(c, gin.H{"ticket": ticket, "expires_in": 60})
}

func (s *Server) runAsyncTask(c *gin.Context, task *process.Task, run func() (string, error)) {
	// 默认使用普通优先级，除非明确指定（如网关操作）
	s.runAsyncTaskWithPriority(c, task, scheduler.PriorityNormal, run)
}

func (s *Server) runAsyncTaskWithPriority(c *gin.Context, task *process.Task, priority scheduler.Priority, run func() (string, error)) {
	// 在串行模式下，RegisterTask 仅负责登记任务开始
	if err := process.RegisterTask(task); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 提交到调度器排队执行
	scheduler.GetScheduler().Submit(scheduler.TaskRequest{
		Task:     task,
		Execute:  func(_ context.Context) (string, error) { return run() },
		Priority: priority,
	})

	c.JSON(http.StatusAccepted, APIResponse{
		Code:    202,
		Message: "Task accepted and queued",
		Data: gin.H{
			"taskID": task.ID,
		},
	})
}

func (s *Server) getTasksStatus(c *gin.Context) {
	s.Success(c, process.GetAllTasks())
}
