package api

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path/filepath"

	"openclaw-buddy/internal/process"

	"github.com/gin-gonic/gin"
)

func (s *Server) getExplorerFilesList(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	files, err := process.ListExplorerFiles(path, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"files": files})
}

func (s *Server) getExplorerFileContent(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	content, err := process.ReadExplorerFile(path, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"content": content})
}

func (s *Server) saveExplorerFileContent(c *gin.Context) {
	var req struct {
		Path    string `json:"path" binding:"required"`
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【保存资源文件】 (Path: %s)", req.Path)
	err := process.WriteExplorerFile(req.Path, req.Content, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}

func (s *Server) renameExplorerFile(c *gin.Context) {
	var req struct {
		OldPath string `json:"oldPath" binding:"required"`
		NewPath string `json:"newPath" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "oldPath and newPath are required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【重命名/移动文件】 (%s -> %s)", req.OldPath, req.NewPath)
	err := process.RenameExplorerFile(req.OldPath, req.NewPath, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}

func (s *Server) searchExplorerFiles(c *gin.Context) {
	rootPath := c.Query("path")
	query := c.Query("query")
	if rootPath == "" || query == "" {
		s.Error(c, http.StatusBadRequest, "path and query are required")
		return
	}

	files, err := process.SearchExplorerFiles(rootPath, query, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"files": files})
}

func (s *Server) deleteExplorerFile(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【删除资源文件】 (Path: %s)", path)
	err := process.DeleteExplorerFile(path, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}

func (s *Server) uploadExplorerFile(c *gin.Context) {
	dirPath := c.PostForm("path")
	if dirPath == "" {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		s.Error(c, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()

	const maxExplorerUploadSize = 100 * 1024 * 1024
	if header.Size > maxExplorerUploadSize {
		s.Error(c, http.StatusRequestEntityTooLarge, "file is too large (max 100MB)")
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, maxExplorerUploadSize+1))
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "failed to read file: "+err.Error())
		return
	}
	if int64(len(data)) > maxExplorerUploadSize {
		s.Error(c, http.StatusRequestEntityTooLarge, "file is too large (max 100MB)")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【上传文件】 (Dir: %s, File: %s)", dirPath, header.Filename)
	destPath, err := process.UploadExplorerFile(dirPath, header.Filename, data, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success", "path": destPath})
}

func (s *Server) downloadExplorerFile(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	data, filename, err := process.ReadExplorerFileBytes(path, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	if filename == "" {
		filename = filepath.Base(path)
	}
	if filename == "" || filename == "." {
		filename = "download"
	}

	// 使用 URL 编码文件名以支持中文字符
	escapedFilename := url.PathEscape(filename)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"; filename*=UTF-8''%s", escapedFilename, escapedFilename))
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Length", fmt.Sprintf("%d", len(data)))
	c.Data(http.StatusOK, "application/octet-stream", data)
}

func (s *Server) createExplorerFile(c *gin.Context) {
	var req struct {
		Path     string `json:"path" binding:"required"`
		Filename string `json:"filename" binding:"required"`
		Content  string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "path and filename are required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【新建文件】 (Dir: %s, Name: %s)", req.Path, req.Filename)
	destPath, err := process.CreateExplorerFile(req.Path, req.Filename, req.Content, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success", "path": destPath})
}

func (s *Server) createExplorerDir(c *gin.Context) {
	var req struct {
		Path    string `json:"path" binding:"required"`
		Dirname string `json:"dirname" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "path and dirname are required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【新建文件夹】 (Dir: %s, Name: %s)", req.Path, req.Dirname)
	destPath, err := process.CreateExplorerDir(req.Path, req.Dirname, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success", "path": destPath})
}
