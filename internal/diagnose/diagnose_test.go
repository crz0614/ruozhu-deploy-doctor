package diagnose

import (
	"strings"
	"testing"
)

func TestEvidenceAndRedaction(t *testing.T) {
	result := Analyze("Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz\nError: Cannot find module 'x'", 1)
	if result.Category != "dependency" || result.Evidence == nil || result.Evidence.Line != 2 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if strings.Contains(Redact("token=private"), "private") {
		t.Fatal("secret leaked")
	}
}

func TestUnknown(t *testing.T) {
	result := Analyze("plain failure", 2)
	if result.Category != "unknown" || result.Evidence != nil {
		t.Fatalf("unexpected result: %#v", result)
	}
}
