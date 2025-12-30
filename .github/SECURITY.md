# Security Policy

## Supported Versions

- Regularly update to the latest version
- Use automated updates with tools like [Watchtower](https://github.com/containrrr/watchtower) for Docker deployments
- Subscribe to release notifications on GitHub

## Reporting a Vulnerability

**Please DO NOT create a public issue on GitHub** as the vulnerability could get exploited. Instead please write an email to git@jasony.org

## Security Best Practices When Deploying

### Docker Deployments
- Use official images from Docker Hub or GitHub Container Registry
- Keep the Docker daemon updated
- Run containers with the least required privileges
- Use environment variables for sensitive configuration (never hardcode secrets)

### Network Security
- Never expose the application directly to the internet without authentication
- Use a reverse proxy (nginx, Caddy) with TLS/SSL
- Use Cloudflare Access or similar services for added security

### Data Security
- Limit file system permissions on the host
- Don't mount excessive volumes into the container
