# Contributing

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

1. **Fork and clone** the repository

   ```bash
   git clone https://github.com/your-username/typescript-quick-starter.git
   cd typescript-quick-starter
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Create a branch** for your changes

   ```bash
   git checkout -b feat/my-feature
   ```

## Development Workflow

```bash
# Build the library
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Lint
pnpm lint

# Fix lint issues
pnpm lint:fix

# Format code
pnpm format

# Type check
pnpm typecheck
```

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/). Each commit message must follow this format:

```text
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

**Types:**

- **feat** - A new feature
- **fix** - A bug fix
- **docs** - Documentation only changes
- **style** - Changes that do not affect the meaning of the code
- **refactor** - A code change that neither fixes a bug nor adds a feature
- **perf** - A code change that improves performance
- **test** - Adding missing tests or correcting existing tests
- **chore** - Changes to the build process or auxiliary tools
- **ci** - Changes to CI configuration files and scripts

## Pull Request Process

1. Update documentation if your changes affect public APIs
2. Add or update tests for your changes
3. Ensure all checks pass (`pnpm lint && pnpm typecheck && pnpm test`)
4. Fill out the pull request template
5. Request review from maintainers

## Code Style

- Follow the existing code style (enforced by ESLint and Prettier)
- Write TypeScript with strict mode enabled
- Export types alongside implementations
- Keep functions small and focused

## Reporting Issues

- Use the [bug report template](https://github.com/your-username/typescript-quick-starter/issues/new?template=bug_report.yml) for bugs
- Use the [feature request template](https://github.com/your-username/typescript-quick-starter/issues/new?template=feature_request.yml) for feature requests
- Check existing issues before creating a new one

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
