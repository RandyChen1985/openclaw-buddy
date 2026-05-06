package process

import "testing"

func TestLooksLikeOpenclawPackageInstallCommand(t *testing.T) {
	cases := []struct {
		line string
		want bool
	}{
		{"npm i openclaw@latest", true},
		{"npm install openclaw", true},
		{"node /usr/lib/node_modules/npm/bin/npm-cli.js i openclaw@2.0.0", true},
		{"pnpm add openclaw@latest", true},
		{"yarn add openclaw", true},
		{"openclaw-update --some-flag", false},
		{"openclaw-doctor --fix", false},
		{"npm run build", false},
		{"npm i lodash", false},
	}
	for _, tc := range cases {
		if got := looksLikeOpenclawPackageInstallCommand(tc.line); got != tc.want {
			t.Errorf("looksLikeOpenclawPackageInstallCommand(%q) = %v, want %v", tc.line, got, tc.want)
		}
	}
}
