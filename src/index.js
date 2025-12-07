import Api from 'openapi-factory';
import { Authorizer } from './authorizer.js';
import McpController from './mcpController.js';
import 'error-object-polyfill';
import logger from './logger.js';

const authorizer = new Authorizer();
const mcpController = new McpController(authorizer);

const api = new Api({
  requestMiddleware(request) {
    logger.startInvocation();
    return request;
  },
  responseMiddleware(request, response) {
    const loggedResponse = response.statusCode >= 400 ? response : { statusCode: response.statusCode };

    const origin = request.headers.origin || request.headers.Origin || request.headers.Referer && new URL(request.headers.Referer).origin
      || request.headers.referer && new URL(request.headers.referer).origin || '*';

    response.headers = Object.assign({
      'Access-Control-Allow-Origin': origin,
      'x-request-id': logger.invocationId,
      'strict-transport-security': 'max-age=31556926; includeSubDomains; preload'
    }, response.headers || {});
    logger.log({ title: 'logger', level: 'INFO', request, response: loggedResponse });
    return response;
  },
  errorMiddleware(request, error) {
    logger.log({ title: 'logger', level: 'ERROR', request, error });

    const origin = request.headers.origin || request.headers.Origin || request.headers.Referer && new URL(request.headers.Referer).origin
      || request.headers.referer && new URL(request.headers.referer).origin || '*';

    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': origin },
      body: { title: 'Unexpected error', errorId: logger.invocationId }
    };
  }
});

export default api;
export const handler = (...args) => api.handler(...args);

function protectedHandler(controllerMethod) {
  return async request => {
    // 1. Get the dynamic Resource ID for validation
    const mcpResourceId = mcpController.getResourceId(request);

    // 2. Run JWT protection check
    try {
      await authorizer.protectResource(request, mcpResourceId);
    } catch (error) {
      if (error.message.statusCode) {
        return error.message;
      }
      throw error;
    }

    // 3. Execute the final controller method
    return controllerMethod(request);
  };
}

/**
 * Creates a handler wrapper for routes that proxy external metadata (e.g., /.well-known/openid-configuration).
 * It explicitly calls the Authorizer's readiness check.
 */
function metadataProxyHandler(controllerMethod) {
  return request => {
    // 1. Run Auth readiness check (ensures AS metadata was fetched)
    authorizer.checkAuthReadiness();

    // 2. Execute the final controller method
    return controllerMethod(request);
  };
}

// --- ROUTE DEFINITIONS ---

// ----------------------------------------------------
// 2. OAUTH/OIDC DISCOVERY ENDPOINTS (Resource Server Metadata)
// ----------------------------------------------------

// AS Config Proxies (Protected by explicit readiness check)
api.get('/.well-known/oauth-authorization-server', metadataProxyHandler(request => mcpController.handleOAuthAuthorizationServer(request)));
api.get('/.well-known/openid-configuration', metadataProxyHandler(request => mcpController.handleOpenIdConfiguration(request)));
api.get('/.well-known/oauth-protected-resource', request => mcpController.handleOAuthProtectedResource(request));

// ----------------------------------------------------
// 3. CORE MCP DISCOVERY ENDPOINTS (No Auth Check required)
// ----------------------------------------------------

api.get('/manifest.json', request => mcpController.handleManifest(request));
api.get('/tools', request => mcpController.handleTools(request));
api.get('/prompts', request => mcpController.handlePrompts(request));

api.post('/mcp', protectedHandler(request => mcpController.handleMcp(request)));
api.get('/sse', protectedHandler(request => mcpController.handleSse(request)));

// ----------------------------------------------------
// GLOBAL FALLBACK AND OPTIONS HANDLERS
// ----------------------------------------------------

// Handle preflight OPTIONS requests for all paths
api.options('/{proxy+}', () => {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Headers': 'content-type,x-amz-date,authorization,x-api-key,x-powered-by,if-unmodified-since,origin,referer,accept,accept-language,accept-encoding,user-agent,content-length,cache-control,pragma,sec-fetch-dest,sec-fetch-mode,sec-fetch-site,sec-gpc,host',
      'Access-Control-Allow-Methods': 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
      'Access-Control-Max-Age': 3600,
      'Cache-Control': 'public, max-age=3600'
    }
  };
});

// Global 404 Handler
api.any('/{proxy+}', request => {
  console.log({ title: '404 Path Not Found', level: 'WARN', request: request });
  return { statusCode: 404 };
});
