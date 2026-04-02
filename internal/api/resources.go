package api

import (
	_ "embed"
)

//go:embed dist/openclaw2.png
var IconData []byte

// NOTE: We need to make sure the file exists in the embed path.
// During build, we will copy web/public/openclaw2.png to internal/api/dist/
