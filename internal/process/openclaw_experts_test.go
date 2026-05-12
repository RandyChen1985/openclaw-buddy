package process

import "testing"

func TestBundledExpertsHaveRequiredFields(t *testing.T) {
	experts, err := GetOpenClawExperts()
	if err != nil {
		t.Fatalf("GetOpenClawExperts() error = %v", err)
	}
	if len(experts) == 0 {
		t.Fatal("expected bundled experts, got none")
	}

	for _, expert := range experts {
		if expert.ID == "" {
			t.Fatal("expert has empty id")
		}
		if expert.Name == "" {
			t.Fatalf("expert %q has empty name", expert.ID)
		}
		if expert.NameEn == "" {
			t.Fatalf("expert %q has empty name_en", expert.ID)
		}
		if expert.Description == "" {
			t.Fatalf("expert %q has empty description", expert.ID)
		}
		if expert.DescriptionEn == "" {
			t.Fatalf("expert %q has empty description_en", expert.ID)
		}
		if expert.Category == "" {
			t.Fatalf("expert %q has empty category", expert.ID)
		}
		if expert.CategoryZh == "" {
			t.Fatalf("expert %q has empty category_zh", expert.ID)
		}
		if expert.IdentityMD == "" {
			t.Fatalf("expert %q has empty identity_md", expert.ID)
		}
		if expert.Soul == "" {
			t.Fatalf("expert %q has empty soul", expert.ID)
		}
		if len(expert.Skills) == 0 {
			t.Fatalf("expert %q has no skills", expert.ID)
		}
	}
}
