package modules

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestStrictFullParityHasNoGenericNotImplementedHandlers(t *testing.T) {
	if os.Getenv("GO_CONTROL_PLANE_REQUIRE_FULL_PARITY") != "1" {
		t.Skip("set GO_CONTROL_PLANE_REQUIRE_FULL_PARITY=1 to enforce full route parity")
	}

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve test file path")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "../.."))
	var offenders []string
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(raw), "NotImplemented") || strings.Contains(string(raw), "Go Control Plane route not implemented yet") {
			offenders = append(offenders, path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(offenders) > 0 {
		t.Fatalf("generic NotImplemented handlers remain: %s", strings.Join(offenders, ", "))
	}
}
