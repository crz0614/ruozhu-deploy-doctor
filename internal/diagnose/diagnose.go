package diagnose

import (
	"regexp"
	"strings"
)

type Evidence struct {
	Line int    `json:"line"`
	Text string `json:"text"`
}

type Result struct {
	Category string    `json:"category"`
	Summary  string    `json:"summary"`
	ExitCode int       `json:"exitCode"`
	Evidence *Evidence `json:"evidence"`
}

type rule struct {
	re       *regexp.Regexp
	category string
	summary  string
}

var rules = []rule{
	{regexp.MustCompile(`(?i)module not found|cannot find module`), "dependency", "A required module cannot be resolved."},
	{regexp.MustCompile(`(?i)type error|typescript error|ts\([0-9]+\)`), "typecheck", "Type checking failed."},
	{regexp.MustCompile(`(?i)test.*failed|assertionerror`), "test", "An automated test failed."},
	{regexp.MustCompile(`(?i)out of memory|heap limit`), "resource", "The build exceeded its memory budget."},
	{regexp.MustCompile(`(?i)timed? out|deadline exceeded`), "timeout", "The step exceeded its time budget."},
}

var secrets = []struct {
	re          *regexp.Regexp
	replacement string
}{
	{regexp.MustCompile(`gh[opsu]_[A-Za-z0-9]{20,}`), "[REDACTED_GITHUB_TOKEN]"},
	{regexp.MustCompile(`sk-[A-Za-z0-9_-]{20,}`), "[REDACTED_API_KEY]"},
	{regexp.MustCompile(`(?i)(authorization\s*:\s*(?:bearer|basic)\s+)[^\s]+`), "$1[REDACTED]"},
	{regexp.MustCompile(`(?i)((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+`), "$1[REDACTED]"},
}

func Redact(input string) string {
	for _, pattern := range secrets {
		input = pattern.re.ReplaceAllString(input, pattern.replacement)
	}
	return input
}

func Analyze(log string, exitCode int) Result {
	lines := strings.Split(Redact(log), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		for _, candidate := range rules {
			if candidate.re.MatchString(lines[index]) {
				return Result{candidate.category, candidate.summary, exitCode, &Evidence{index + 1, lines[index]}}
			}
		}
	}
	return Result{"unknown", "The process failed without a recognized signature.", exitCode, nil}
}
