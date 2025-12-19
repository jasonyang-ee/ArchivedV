# Security Policy

## Supported Versions

ArchivedV is actively maintained. We recommend always running the latest version. Older versions may not receive security updates.

To keep your instance secure:
- Regularly update to the latest version
- Use automated updates with tools like [Watchtower](https://github.com/containrrr/watchtower) for Docker deployments
- Subscribe to release notifications on GitHub

## Reporting a Vulnerability

Thank you for taking the time to responsibly report a vulnerability in ArchivedV.

**Please DO NOT create a public issue on GitHub** as this could compromise the security of the project and its users.

### How to Report

1. **Email**: Send a detailed report to the maintainers with the subject line: `[SECURITY] ArchivedV Vulnerability Report`
2. **Include**:
   - A clear description of the vulnerability
   - Steps to reproduce (if applicable)
   - Affected version(s)
   - Potential impact
   - Suggested fix (if you have one)

3. **Contact**: You can find the maintainer's email in the repository's `package.json` or GitHub profile

### What to Expect

- Acknowledgment of your report within 48 hours
- Regular updates on the investigation and fix
- Credit in the security advisory (unless you prefer anonymity)
- Coordinated disclosure timeline

## Security Best Practices

When deploying ArchivedV:

### Docker Deployments
- Use official images from Docker Hub or GitHub Container Registry
- Keep the Docker daemon updated
- Run containers with the least required privileges
- Use environment variables for sensitive configuration (never hardcode secrets)
- Enable Docker security scanning

### Network Security
- Never expose the application directly to the internet without authentication
- Use a reverse proxy (nginx, Caddy) with TLS/SSL
- Restrict access to trusted networks or IP ranges
- Use strong authentication credentials

### Data Security
- Secure your database (`data/db.json`)
- Use encrypted backups
- Limit file system permissions on the host
- Consider running in a containerized environment with restricted resources

### Updates
- Enable Dependabot to track dependency updates
- Review and apply security patches promptly
- Test updates in a staging environment first

## Dependencies

ArchivedV depends on several open-source projects:
- **yt-dlp**: For video downloading functionality
- **Express.js**: Backend framework
- **React**: Frontend framework
- **Node.js**: Runtime environment

We regularly update these dependencies to ensure we're using secure, up-to-date versions. You can view our dependency tree by examining `package.json` and `package-lock.json`.

## Automatic Dependency Updates

We use [Dependabot](https://dependabot.com/) to automatically check for updates to our dependencies. This includes:
- Version updates
- Security vulnerability alerts
- Compatibility checks

## Questions?

If you have security-related questions or concerns, please reach out to the maintainers privately rather than through public issues.
