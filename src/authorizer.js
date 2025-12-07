import { jwtVerify, createRemoteJWKSet } from 'jose';
import { URL } from 'url';
import logger from './logger.js';
import ApplicationError from 'error-object-polyfill';

// --- CONFIGURATION CONSTANTS (Shared) ---
export const AUTHORIZATION_SERVER_URL = 'https://login.adventuresindevops.com';
const DISCOVERY_URL = `${AUTHORIZATION_SERVER_URL}/.well-known/openid-configuration`;
export const SUPPORTED_SCOPES = ['mcp:read', 'mcp:write', 'profile'];

export class Authorizer {
  constructor() {
    // State to hold external dependency data
    this.DISCOVERY_METADATA = null;
    this.JWKS_PROVIDER = null;
  }

  /**
   * Fetches the OIDC Discovery Metadata and initializes the JWKS provider using JOSE.
   * This must be called once at application startup.
   */
  async initializeAuthMetadata() {
    if (this.DISCOVERY_METADATA && this.JWKS_PROVIDER) {
      return;
    }

    logger.log({ title: `Fetching OIDC Discovery from: ${DISCOVERY_URL}` });
    try {
      const response = await fetch(DISCOVERY_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      this.DISCOVERY_METADATA = await response.json();
      
      const jwksUri = this.DISCOVERY_METADATA.jwks_uri;
      if (!jwksUri) {
        throw new Error("Discovery metadata is missing 'jwks_uri'.");
      }

      this.JWKS_PROVIDER = createRemoteJWKSet(new URL(jwksUri));
      logger.log({ title: `Auth Metadata initialized successfully. JWKS URI: ${jwksUri}` });
    } catch (error) {
      logger.error({ title: 'FATAL: Failed to initialize Auth Metadata.', error: error.message });
      // In a serverless environment, we log and proceed to allow 503 errors on relevant endpoints.
    }
  }

  checkAuthReadiness() {
    if (this.DISCOVERY_METADATA) {
      return;
    }
    logger.error({ title: 'Dependency Check Failed: Auth Metadata is null.' });
    throw ApplicationError({
      statusCode: 503,
      body: JSON.stringify({
        error: 'service_unavailable',
        error_description: 'Critical Auth metadata dependency not initialized. Check server logs for failed fetch from AS.'
      }),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Middleware/Pre-handler to validate the JWT Access Token against the Authorization Server's JWKS.
   * Returns null on success, or an error response object on failure.
   */
  async protectResource(req, mcpResourceId) {
    // Skip validation if critical metadata is missing
    if (!this.DISCOVERY_METADATA || !this.JWKS_PROVIDER) {
      throw ApplicationError({
        statusCode: 503,
        body: JSON.stringify({
          error: 'service_unavailable',
          error_description: 'Cannot validate token. AS metadata unavailable.'
        }),
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw ApplicationError({
        statusCode: 401,
        body: JSON.stringify({
          error: 'unauthorized',
          error_description: 'Authorization header is missing or invalid. Initiate OAuth flow.'
        }),
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer realm="${mcpResourceId}", authorization_servers="${AUTHORIZATION_SERVER_URL}", scopes="${SUPPORTED_SCOPES.join(' ')}"`
        }
      });
    }

    const token = authHeader.split(' ')[1];
    
    try {
      const { payload } = await jwtVerify(
        token,
        this.JWKS_PROVIDER,
        {
          issuer: this.DISCOVERY_METADATA.issuer,
          audience: mcpResourceId,
          algorithms: ['EdDSA']
        }
      );

      req.claims = payload;
      return null;
    } catch (err) {
      logger.error({ title: 'JWT verification failed (JOSE error):', error: err.message });
      throw ApplicationError({
        statusCode: 401,
        body: JSON.stringify({
          error: 'invalid_token',
          error_description: `JWT verification failed: ${err.message}`
        }),
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
}
