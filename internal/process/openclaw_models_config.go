package process

import (
	"fmt"
	"strings"
)

func GetOpenClawModelsConfig(configDir string) (map[string]interface{}, error) {
	fullCfg, err := readOpenClawConfig(configDir)
	if err != nil {
		return nil, err
	}

	models, ok := fullCfg["models"].(map[string]interface{})
	if !ok {
		return make(map[string]interface{}), nil
	}

	providers, ok := models["providers"].(map[string]interface{})
	if !ok {
		return make(map[string]interface{}), nil
	}

	return providers, nil
}

func AddOpenClawProvider(configDir, name string, config map[string]interface{}) error {
	return updateOpenClawConfig(configDir, func(fullCfg map[string]interface{}) error {
		models := ensureMap(fullCfg, "models")
		providers := ensureMap(models, "providers")

		// 如果 Provider 已存在，保留原有的 models 列表
		if existing, ok := providers[name].(map[string]interface{}); ok {
			if existingModels, ok := existing["models"]; ok {
				config["models"] = existingModels
			}
		} else if _, ok := config["models"]; !ok {
			config["models"] = []interface{}{}
		}

		providers[name] = config

		// --- 3. 处理 agents.defaults.models 注册部分 (同步该 Provider 下所有已定义模型) ---
		agents := ensureMap(fullCfg, "agents")
		defaults := ensureMap(agents, "defaults")
		registeredModels := ensureMap(defaults, "models")

		if providerModels, ok := config["models"].([]interface{}); ok {
			for _, m := range providerModels {
				if model, isMap := m.(map[string]interface{}); isMap {
					if modelID, idOk := model["id"].(string); idOk && modelID != "" {
						registrationKey := fmt.Sprintf("%s/%s", name, modelID)
						if _, exists := registeredModels[registrationKey]; !exists {
							registeredModels[registrationKey] = make(map[string]interface{})
						}
					}
				}
			}
		}
		return nil
	})
}

func AddOpenClawModelToProvider(configDir, providerName string, modelConfig map[string]interface{}) error {
	return updateOpenClawConfig(configDir, func(fullCfg map[string]interface{}) error {
		// --- 1. 处理 models.providers 部分 ---
		models := ensureMap(fullCfg, "models")
		providers := ensureMap(models, "providers")

		provider, ok := providers[providerName].(map[string]interface{})
		if !ok {
			return fmt.Errorf("provider %s not found", providerName)
		}

		providerModels, ok := provider["models"].([]interface{})
		if !ok {
			providerModels = []interface{}{}
		}

		// OpenClaw model schema uses "input"; "capabilities" is only a UI compatibility alias.
		delete(modelConfig, "capabilities")

		// 补齐模型配置默认值
		if _, ok := modelConfig["cost"]; !ok {
			modelConfig["cost"] = map[string]interface{}{
				"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
			}
		}
		if _, ok := modelConfig["contextWindow"]; !ok {
			modelConfig["contextWindow"] = 128000
		}
		if _, ok := modelConfig["maxTokens"]; !ok {
			modelConfig["maxTokens"] = 4096
		}
		if _, ok := modelConfig["compat"]; !ok {
			modelConfig["compat"] = map[string]interface{}{
				"supportsStore": false, "supportsDeveloperRole": false,
			}
		}

		// [Hardening] 检查是否存在相同 ID 的模型，如有则更新
		modelID, _ := modelConfig["id"].(string)
		foundIdx := -1
		for i, m := range providerModels {
			if model, isMap := m.(map[string]interface{}); isMap {
				if id, idOk := model["id"].(string); idOk && id == modelID {
					foundIdx = i
					break
				}
			}
		}

		if foundIdx >= 0 {
			providerModels[foundIdx] = modelConfig
		} else {
			providerModels = append(providerModels, modelConfig)
		}
		provider["models"] = providerModels

		// --- 2. 处理 agents.defaults.models 注册部分 ---
		agents := ensureMap(fullCfg, "agents")
		defaults := ensureMap(agents, "defaults")
		registeredModels := ensureMap(defaults, "models")

		// 注册格式: "provider/id": {}
		if modelID != "" {
			registrationKey := fmt.Sprintf("%s/%s", providerName, modelID)
			if _, exists := registeredModels[registrationKey]; !exists {
				registeredModels[registrationKey] = make(map[string]interface{})
			}
		}
		return nil
	})
}

func DeleteOpenClawModelFromProvider(configDir, providerName, modelID string) error {
	return updateOpenClawConfig(configDir, func(fullCfg map[string]interface{}) error {
		// --- 1. 处理 models.providers 部分 ---
		models, ok := fullCfg["models"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("models section not found")
		}

		providers, ok := models["providers"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("providers section not found")
		}

		provider, ok := providers[providerName].(map[string]interface{})
		if !ok {
			return fmt.Errorf("provider %s not found", providerName)
		}

		providerModels, ok := provider["models"].([]interface{})
		if !ok {
			return fmt.Errorf("models list not found for provider %s", providerName)
		}

		newProviderModels := []interface{}{}
		found := false
		for _, m := range providerModels {
			if model, isMap := m.(map[string]interface{}); isMap {
				if id, idOk := model["id"].(string); idOk && id == modelID {
					found = true
					continue
				}
			}
			newProviderModels = append(newProviderModels, m)
		}

		if !found {
			return fmt.Errorf("model %s not found in provider %s", modelID, providerName)
		}

		provider["models"] = newProviderModels
		providers[providerName] = provider // 更新 provider

		// --- 2. 处理 agents.defaults.models 注册部分 ---
		// 同样需要从 defaults.models 中移除
		agents, ok := fullCfg["agents"].(map[string]interface{})
		if ok { // 只有 agents 存在才处理
			defaults, ok := agents["defaults"].(map[string]interface{})
			if ok { // 只有 defaults 存在才处理
				registeredModels, ok := defaults["models"].(map[string]interface{})
				if ok { // 只有 registeredModels 存在才处理
					registrationKey := fmt.Sprintf("%s/%s", providerName, modelID)
					delete(registeredModels, registrationKey)
					defaults["models"] = registeredModels
				}
				agents["defaults"] = defaults
			}
			fullCfg["agents"] = agents
		}
		return nil
	})
}

func DeleteOpenClawProvider(configDir, providerName string) error {
	return updateOpenClawConfig(configDir, func(fullCfg map[string]interface{}) error {
		// 1. 从 models.providers 中移除
		models, ok := fullCfg["models"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("models section not found")
		}

		providers, ok := models["providers"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("providers section not found")
		}

		if _, ok := providers[providerName]; !ok {
			return fmt.Errorf("provider %s not found", providerName)
		}

		delete(providers, providerName)

		// 2. 从 agents.defaults.models 中移除该渠道下的所有模型注册
		agents, ok := fullCfg["agents"].(map[string]interface{})
		if ok {
			defaults, ok := agents["defaults"].(map[string]interface{})
			if ok {
				registeredModels, ok := defaults["models"].(map[string]interface{})
				if ok {
					prefix := providerName + "/"
					for key := range registeredModels {
						if strings.HasPrefix(key, prefix) {
							delete(registeredModels, key)
						}
					}
					defaults["models"] = registeredModels
				}
				agents["defaults"] = defaults
			}
			fullCfg["agents"] = agents
		}
		return nil
	})
}
