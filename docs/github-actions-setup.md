# Setting Up GitHub Actions for Cloudflare Workers Deployment

This guide explains how to set up the required GitHub repository secrets to enable automatic deployments to Cloudflare Workers when pushing to the `master` branch.

## Required Secrets

Before the GitHub Actions workflow can deploy your application, you need to add the following secrets to your GitHub repository:

### 1. `CF_API_TOKEN`

This is a Cloudflare API token with permissions to deploy Workers and manage Durable Objects.

To create this token:

1. Log in to your Cloudflare dashboard
2. Go to "My Profile" > "API Tokens"
3. Click "Create Token"
4. Select "Create Custom Token"
5. Name the token (e.g., "ZK Battleship GitHub Deployment")
6. Add the following permissions:
   - Account > Workers Scripts > Edit
   - Account > Workers KV Storage > Edit
   - Account > Durable Objects > Edit
   - Account > Account Settings > Read
7. Set the Account Resources to include your Cloudflare account
8. Create the token and copy it

### 2. `CF_ACCOUNT_ID`

This is your Cloudflare account ID.

To find this:

1. Log in to your Cloudflare dashboard
2. Go to Workers & Pages
3. Your account ID is shown in the URL: `https://dash.cloudflare.com/<ACCOUNT_ID>/workers`

### 3. `BASE_RPC_URL`

This is the RPC URL for Base Mainnet.

Typical value: `https://mainnet.base.org`

For production, you should use a dedicated RPC provider like Alchemy, Infura, or QuickNode.

### 4. `BASE_SEPOLIA_RPC_URL`

This is the RPC URL for Base Sepolia testnet.

Typical value: `https://sepolia.base.org`

For testing, you can use this public endpoint, but for production, a dedicated RPC provider is recommended.

### 5. `GAME_FACTORY_ADDRESS`

This is the address of your deployed Game Factory contract on Base Sepolia or Base Mainnet.

Format: `0x...` (42 characters, starting with 0x)

## Adding Secrets to GitHub

1. Go to your GitHub repository
2. Click on "Settings" > "Secrets and variables" > "Actions"
3. Click "New repository secret"
4. Add each secret one by one with the name exactly as listed above
5. Click "Add secret" after entering each name and value

## Verifying Setup

After adding the secrets:

1. Push a change to your master branch
2. Go to the "Actions" tab in your GitHub repository
3. You should see the "Deploy to Cloudflare Workers" workflow running
4. Once completed successfully, your application will be deployed to Cloudflare Workers

## Troubleshooting

If the deployment fails, check the logs in the GitHub Actions run for specific errors:

- **Authentication errors**: Verify your CF_API_TOKEN has the correct permissions
- **Account errors**: Ensure your CF_ACCOUNT_ID is correct
- **Build errors**: Check if your code passes all checks and can build successfully
- **Deployment errors**: Look for specific Wrangler error messages in the logs

## Manual Deployment

If you need to deploy manually:

```bash
# Install dependencies
npm install

# Log in to Cloudflare (if you haven't already)
npx wrangler login

# Deploy the worker
npm run deploy
```