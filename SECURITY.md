# Security

## Supported versions

Security fixes are applied to the latest released minor version.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not open a public issue containing API keys, exploit details, or private Ghost content.

Rotate any credential that may have appeared in a log, screenshot, issue, or chat transcript. Never commit Ghost keys.

## Deployment boundary

Version 0.1 is a local stdio server. Do not expose it as a network service. A remote transport requires a separate authentication and threat-model review.
