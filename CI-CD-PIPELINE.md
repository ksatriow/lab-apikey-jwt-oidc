# Enterprise-Grade CI/CD & AWS Setup

This repository uses a high-performance, enterprise-grade GitHub Actions pipeline (`.github/workflows/ecr-push.yml`) to build and push Docker images to Amazon ECR.

## 🏗️ Pipeline Architecture

This repository uses a **Reusable Workflow Architecture** to separate environments while keeping the build logic centralized.

### Workflow Files:
- [ecr-push.yml](file:///Users/kukuhsatriowibowo/lab-apikey-jwt-oidc/.github/workflows/ecr-push.yml): The **Template**. Contains the core logic for building, scanning, and pushing to ECR.
- [build_dev.yaml](file:///Users/kukuhsatriowibowo/lab-apikey-jwt-oidc/.github/workflows/build_dev.yaml): The **Dev Caller**. Triggers on `develop` branch.
- [build_prod.yaml](file:///Users/kukuhsatriowibowo/lab-apikey-jwt-oidc/.github/workflows/build_prod.yaml): The **Prod Caller**. Triggers on `main` branch.

1. **Manager Updates Version (In GitHub Environments):** Go to **Settings** -> **Environments** -> Select `dev` or `production`.
2. **Set Variables in Environment:**
   - In the **dev** environment: Set `APIKEY_VERSION_DEV`, `JWT_VERSION_DEV`, etc.
   - In the **production** environment: Set `APIKEY_VERSION_PROD`, `JWT_VERSION_PROD`, etc.
3. **Trigger Release:** Run the corresponding workflow from the **Actions** tab. The template will automatically pull the correct variables from the environment you selected.

*Note:* Pushes to `main` (via `build_prod.yaml`) automatically target the `production` environment, enforcing any "Required Reviewers" approval gate configured in GitHub.

---

### 📧 Notifikasi Email (via curl)

Pipeline ini dikonfigurasi untuk mengirimkan notifikasi status rilis (Gagal/Berhasil) ke gateway internal perusahaan menggunakan `curl`:

1.  **Siapkan GitHub Secrets**:
    - `NOTIFY_ENDPOINT`: URL API gateway perusahaan.
    - `NOTIFY_TOKEN`: Token otentikasi (Bearer).
2.  **Mekanisme**: Setiap build selesai (baik sukses maupun gagal), pipeline akan memicu pemanggilan API POST dengan payload JSON yang berisi status, nama service, environment, dan link log.

---

### 🔐 Security & IAM Roles

Untuk membedakan izin AWS (*IAM Role*) antara **dev** dan **production**, kita menggunakan **GitHub Secrets** dengan akhiran (prefix) yang sama seperti variabel:

1.  **Buka GitHub Settings** -> **Secrets and variables** -> **Actions** -> **Secrets**.
2.  Tambahkan dua secret baru:
    - **`AWS_ROLE_ARN_DEV`**: Masukkan ARN Role khusus Development.
    - **`AWS_ROLE_ARN_PROD`**: Masukkan ARN Role khusus Production.

*Note:* Pipeline akan otomatis mendeteksi environment yang sedang berjalan dan mengambil secret yang sesuai (`_DEV` jika di dev, `_PROD` jika di production).

### 📜 IAM Trust Policy (Wajib Update)

Karena kita menggunakan Environment, Anda **WAJIB** mengupdate **Trust Relationship** pada IAM Role di AWS Console agar mengizinkan akses dari sub-path repositori Anda:

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
                "Federated": "arn:aws:iam::172982316609:oidc-provider/token.actions.githubusercontent.com"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
                },
                "StringLike": {
                    "token.actions.githubusercontent.com:sub": [
                        "repo:ksatriow/lab-apikey-jwt-oidc:ref:refs/heads/main",
                        "repo:ksatriow/lab-apikey-jwt-oidc:ref:refs/heads/develop",
                        "repo:ksatriow/lab-apikey-jwt-oidc:*"
                    ]
                }
            }
        }
    ]
}
```
> [!IMPORTANT]
> Pastikan Anda menggunakan **`StringLike`** (bukan `StringEquals`) dan akhiri dengan **`:*`**. Ini wajib karena kita menggunakan "GitHub Environments" (dev/production), sehingga ID pengenal dari GitHub akan berubah-ubah formatnya. Wildcard `:*` memastikan AWS tetap mengenali repositori Anda baik saat rilis reguler maupun manual.

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
        "ecr:PutImage",
        "ecr:StartImageScan",
        "ecr:DescribeImageScanFindings"
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

## EXAMPLE

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
        "ecr:PutImage",
        "ecr:StartImageScan",
        "ecr:DescribeImageScanFindings"
      ],
      "Resource": [
        "arn:aws:ecr:ap-southeast-3:<ACCOUNT_ID>:repository/apikey",
        "arn:aws:ecr:ap-southeast-3:<ACCOUNT_ID>:repository/jwt",
        "arn:aws:ecr:ap-southeast-3:<ACCOUNT_ID>:repository/oidc-app",
        "arn:aws:ecr:ap-southeast-3:<ACCOUNT_ID>:repository/mock-idp"
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

