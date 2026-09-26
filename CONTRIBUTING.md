# Contributing to Alvyn

Thank you for your interest in contributing to **Alvyn** — a Kotlin Event Sourcing Framework built on PostgreSQL.  
We welcome contributions from everyone who wants to make building CQRS and event-sourced systems on the JVM easier.

---

## 📦 Project Overview

Alvyn provides a lightweight, type-safe foundation for building **event-sourced** Kotlin applications with **CQRS** patterns backed by **PostgreSQL**.  
The project targets the **JVM** and is built with **Gradle (Kotlin DSL)** using the **latest Kotlin and Java LTS** versions.

---

## 🧰 Prerequisites

- **JDK:** Latest LTS (currently Java 21)
- **Kotlin:** Latest stable release
- **Gradle:** Wrapper included (`./gradlew`)
- **Database:** PostgreSQL (used for integration testing)
- **IDE:** IntelliJ IDEA (recommended)

---

## 🧩 Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/lox-solutions/alvyn.git
   cd alvyn
   ```

2. **Build the project**
   ```bash
   ./gradlew clean build
   ```

3. **Run tests**
   ```bash
   ./gradlew test
   ```

4. **Run integration tests** (requires Docker)
   ```bash
   ./gradlew integrationTest
   ```
   Integration tests spin up a PostgreSQL container via **Testcontainers**.

5. **Check code style**
   ```bash
   ./gradlew ktlintCheck
   ```

6. **Generate coverage report**
   ```bash
   ./gradlew jacocoTestReport
   ```
   The project requires **≥ 80 % coverage** for contributions to be accepted.

---

## 🧪 Code Style & Quality

- Code formatting is enforced by **ktlint**.  
  The configuration is defined in `.editorconfig`.
- All new code **must compile without warnings** and pass all tests.
- Static analysis tools (e.g. Detekt) may be added later — follow future guidelines when introduced.

---

## 🧠 Commit & Branching Guidelines

- Follow the **[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)** format:

  ```
  feat: add event store migration utility
  fix: correct deserialization of aggregate snapshot
  docs: update README with setup steps
  ```

- Target the **`main`** branch (trunk-based development).
- Always use **signed commits** (`git commit -S`) and include the **DCO sign-off** (`-s`):

  ```bash
  git commit -s -S -m "feat: improve projection consistency"
  ```

  This automatically adds:

  ```
  Signed-off-by: Your Name <you@example.com>
  ```

  Signing and DCO are required for all contributions.

---

## 🔄 Pull Requests

Before submitting a pull request:

1. Create a new branch:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes.
3. Ensure all checks pass locally.
4. Push your branch and open a Pull Request against `main`.

### PR Checklist

- [ ] Code compiles and passes all tests  
- [ ] Code style matches `ktlint` rules  
- [ ] Coverage ≥ 80 %  
- [ ] Commit messages follow **Conventional Commits**  
- [ ] Commits are **signed** and include **DCO sign-off**  
- [ ] PR description clearly states purpose and scope  
- [ ] All CI checks pass  

---

## 🔍 Review & Merge Policy

- At least **one reviewer** must approve the PR.
- All **status checks** (build, tests, integration, lint) must pass.
- **Squash Merge** is the only allowed merge method.  
  The resulting commit message should follow the Conventional Commit format.

---

## 🏗️ CI/CD

GitHub Actions run the following workflows:

- **Build & Test:** runs `./gradlew build` and unit tests.
- **Integration Tests:** uses Testcontainers to test against real PostgreSQL.
- **Release-Please:** automates semantic versioning and changelog generation.
- **Publish:** pushes artifacts to **Maven Central** after release tagging.

---

## 🧾 Versioning

Alvyn follows **[Semantic Versioning 2.0.0](https://semver.org/)**.

Releases are managed automatically by **Release-Please**,  
which derives new versions from commit messages (`feat`, `fix`, `perf`, etc.).

---

## 🧱 Labels & Issues

We use a standard set of labels to organize work:

| Label | Purpose |
|-------|----------|
| `good first issue` | suitable for new contributors |
| `help wanted` | open for community contribution |
| `bug` | defect or regression |
| `enhancement` | feature or improvement |
| `documentation` | docs-related task |
| `test` | testing-related issue |

When in doubt, open an issue before starting a major change.

---

## 🔐 Security

Security vulnerabilities must **not** be reported via public issues.  
Please follow the instructions in [`SECURITY.md`](./SECURITY.md).

---

## 🧭 Code of Conduct

All contributors are expected to follow the **[Code of Conduct](./CODE_OF_CONDUCT.md)**.  
Be respectful, inclusive, and collaborative in all interactions.

---

## ⚖️ License

Contributions to Alvyn are licensed under the **[Apache License 2.0](./LICENSE)**.

By submitting code, you agree that your contributions will be distributed under this license and that you have the right to do so.

---

## 💡 Tips for Contributors

- Keep pull requests **focused** and **small** when possible.  
- Write tests for every new feature or bug fix.  
- Document public APIs with **KDoc**.  
- Prefer immutability and pure functions where possible.  
- Keep event names, aggregates, and projections consistent.

---

## 💬 Communication

- Use **GitHub Discussions** for general questions and design ideas.  
- Use **Issues** for bugs and feature requests.  
- Major design proposals can be opened as **RFC discussions** before implementation.

---

Thanks again for contributing to **Alvyn** —  
your efforts make the Kotlin event sourcing ecosystem stronger!
