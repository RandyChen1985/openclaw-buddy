package process

type OpenClawBot struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Model        string   `json:"model"`
	Emoji        string   `json:"emoji"`
	Workspace    string   `json:"workspace"`
	AgentDir     string   `json:"agentDir"`
	RoutingRules string   `json:"routingRules"`
	Routing      string   `json:"routing"`
	Capabilities []string `json:"capabilities"`
	Input        []string `json:"input"`
}

type OpenClawModel struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Provider     string   `json:"provider"`
	IsDefault    bool     `json:"isDefault"`
	Capabilities []string `json:"capabilities"`
	Input        []string `json:"input"`
}
