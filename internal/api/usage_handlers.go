package api

import (
	"fmt"
	"net/http"

	"openclaw-buddy/internal/process"

	"github.com/gin-gonic/gin"
)

func (s *Server) getUsageCost(c *gin.Context) {
	daysStr := c.DefaultQuery("days", "30")
	forceStr := c.DefaultQuery("force", "false")
	var days int
	fmt.Sscanf(daysStr, "%d", &days)
	force := forceStr == "true"

	data, err := process.GetUsageCost(days, force)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, data)
}
