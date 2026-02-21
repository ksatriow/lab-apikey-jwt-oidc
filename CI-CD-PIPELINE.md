# Enterprise-Grade CI/CD & AWS Setup

This repository uses a high-performance, enterprise-grade GitHub Actions pipeline (`.github/workflows/ecr-push.yml`) to build and push Docker images to Amazon ECR.

## 🏗️ Pipeline Architecture

The pipeline is split into a **Two-Phase Release System** to enforce strict Manager-based version numbering while maintaining rapid developer feedback.

### Phase 1: Automated Push (Developer Feedback)
When a developer pushes code to `main` or `develop`, the pipeline runs automatically but **stops before pushing to ECR**.
* **Smart Filter (`detect-changes`):** Analyzes the Git diff to find exactly which folders changed (e.g., only `jwt/`). Outputs a dynamic JSON array.
* **Build Test (`build-test`):** Uses Matrix Parallelization and Buildx Caching to perform a dry-run Docker build. This ensures the code *can* compile, providing immediate feedback without polluting the container registry with untagged or automated-SHA images.

### Phase 2: Manual Release (Manager Approval)
When a manager decides to cut a release, they trigger the workflow manually (`workflow_dispatch`).
* **Strict Tag Injection:** The manager MUST input their explicit release number (e.g., `v1.2.0`). Without this, the workflow cannot start.
* **Environment Gates:** The manager selects the environment (e.g., `production`). If GitHub Environments are configured, this will pause the workflow and require a secondary human click to Approve the production deployment.
* **Build and Push (`build-and-push`):** Bypasses the git diff, uses Matrix Parallelization to concurrently build the selected services, and securely pushes them to AWS ECR using OIDC, tagged exclusively with the Manager's version number and `latest`.

---

## 🔒 Configuration Guide

The following guide explains how to set up the OIDC trust relationship and GitHub Environments required for this pipeline to work.


This guide explains how to set up the trust relationship between GitHub Actions and your AWS account using OIDC. This allows GitHub to push Docker images to ECR without needing long-lived access keys.

---

## 1. Create OIDC Identity Provider

You only need to do this once per AWS account.

1.  Open the **IAM Console**.
2.  Go to **Identity Providers** > **Add provider**.
3.  Select **OpenID Connect**.
4.  **Provider URL**: `https://token.actions.githubusercontent.com` (Click "Get thumbprint").
5.  **Audience**: `sts.amazonaws.com`.
6.  Click **Add provider**.

---

## 2. Create IAM Role for GitHub Actions

This role will be assumed by the GitHub Action workflow.

1.  Go to **IAM Roles** > **Create role**.
2.  Select **Custom trust policy**.
3.  Paste the following policy (replace `<ORG>` and `<REPO>` with your GitHub details):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<YOUR_AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<ORG>/<REPO>:*"
        }
      }
    }
  ]
}
```

4.  Click **Next**.
5.  Add permissions. Create a new policy with this **Least Privilege** configuration. This restricts GitHub's access ONLY to your specific repositories:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAuthToken",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "AllowPushPullToSpecificRepos",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage"
      ],
      "Resource": [
        "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/apikey",
        "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/jwt",
        "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/oidc-app",
        "arn:aws:ecr:<REGION>:<ACCOUNT_ID>:repository/mock-idp"
      ]
    }
  ]
}
```
> [!NOTE]
> `ecr:GetAuthorizationToken` always requires `*` because it's a global call to authenticate with ECR. However, the subsequent actions are strictly limited to the listed repository ARNs.

6.  Name the role (e.g., `github-actions-ecr-push`).
7.  Copy the **Role ARN** (e.g., `arn:aws:iam::123456789012:role/github-actions-ecr-push`).


---

## 3. Configure GitHub Secrets & Variables

In your GitHub repository, go to **Settings** > **Secrets and variables** > **Actions**.

### Repository Secrets
- `AWS_ROLE_ARN`: The ARN of the role you created in Step 2.

### Repository Variables
- `AWS_REGION`: The AWS region where your ECR repos are (e.g., `us-east-1`).

---

## 5. Configure GitHub Environment for Production Approval

To enforce an approval gate for production, you must use GitHub Environments.

1.  In your GitHub repository, go to **Settings** > **Environments**.
2.  Click **New environment**.
3.  Name it `production`.
4.  Under **Deployment protection rules**, check **Required reviewers**.
5.  Add yourself (or others) as authorized reviewers.
6.  Click **Save protection rules**.

Now, whenever you run the workflow and select `production` as the environment, GitHub will pause the run and send an email/notification to the reviewers. The push to ECR will only proceed after it's approved.

---

## 6. Create ECR Repositories

Make sure to create these repositories in Amazon ECR before running the workflow:
- `apikey`
- `jwt`
- `oidc-app`
- `mock-idp`

