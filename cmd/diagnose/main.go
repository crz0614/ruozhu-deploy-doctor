package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/crz0614/ruozhu-deploy-doctor/internal/diagnose"
)

func main() {
	exitCode := flag.Int("exit-code", 1, "process exit code")
	flag.Parse()
	input, err := io.ReadAll(io.LimitReader(os.Stdin, 10<<20))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	if err = json.NewEncoder(os.Stdout).Encode(diagnose.Analyze(string(input), *exitCode)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}
