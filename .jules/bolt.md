## 2024-05-05 - [Regex Hoisting for performance]
**Learning:** Compiling regexes on every method call inside a loop or frequently executed method can degrade performance. Hoisting them to file-scoped constants ensures they are compiled once at module load time.
**Action:** Extract inline regex constants (`/pattern/g`) out of class methods when they don't depend on instance variables.
