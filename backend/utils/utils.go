package utils

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
)

func GetEnv(key, defaultValue string) string {
	value := os.Getenv(key)
	if len(value) == 0 {
		return defaultValue
	}
	return value
}

// GetSecretEnv resolves a sensitive setting that may be supplied either
// inline (KEY=value) or as a file (KEY_FILE=/run/secrets/name), the
// convention Docker Compose `secrets:` and Kubernetes Secret volumes use.
// The file wins when both are set. Its contents are read once and trailing
// CR/LF stripped, so a secret written with `echo` works. A KEY_FILE that
// cannot be read is fatal: the operator asked for a secret the process
// cannot honour, and running without it would be silently wrong.
//
// The value is never logged; only the path is.
func GetSecretEnv(key string) string {
	if path := os.Getenv(key + "_FILE"); path != "" {
		value, err := readSecretFile(key, path)
		if err != nil {
			log.Fatalf("%v", err)
		}
		return value
	}
	return os.Getenv(key)
}

// readSecretFile does the actual read for GetSecretEnv. Split out so the
// error path can be exercised by a test without going through log.Fatalf.
// The returned error identifies the variable and the file PATH only — it is
// built from os.ReadFile's own error (which itself never quotes file
// contents), so a secret's bytes can never reach it.
func readSecretFile(key, path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("cannot read %s_FILE=%q: %w", key, path, err)
	}
	return strings.TrimRight(string(data), "\r\n"), nil
}

func LastString(str []string) string {
	return str[len(str)-1]
}

func ResponseError(w http.ResponseWriter, err error) {
	w.WriteHeader(http.StatusInternalServerError)
	w.Write([]byte(err.Error()))
}

func ResponseErrorStatus(w http.ResponseWriter, err error, status int) {
	w.WriteHeader(status)
	w.Write([]byte(err.Error()))
}

func ResponseSuccess(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(data)
}
