import { SUPPORTED_SCOPES, AUTHORIZATION_SERVER_URL } from './authorizer.js';

export default class McpController {
  constructor(authorizer) {
    this.authorizer = authorizer;
  }

  getResourceId(req) {
    const host = req.headers.host || req.headers.Host;
    return `https://${host}`;
  }

  // --- 2. OAUTH/OIDC DISCOVERY HANDLERS ---
    
  // The Resource Server proxies the AS's discovery metadata
  handleOAuthAuthorizationServer() {
    // The checkAuthReadiness is called in the route definition
    return {
      statusCode: 200,
      body: JSON.stringify(this.authorizer.DISCOVERY_METADATA),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  // OIDC discovery endpoint (proxies to the one above)
  handleOpenIdConfiguration() {
    return this.handleOAuthAuthorizationServer();
  }

  // RFC 9728: Resource Server's own metadata.
  handleOAuthProtectedResource(req) {
    const mcpResourceId = this.getResourceId(req);
    return {
      statusCode: 200,
      body: JSON.stringify({
        resource: mcpResourceId,
        authorization_servers: [AUTHORIZATION_SERVER_URL],
        bearer_methods_supported: ['header'],
        scopes_supported: SUPPORTED_SCOPES
      }),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  // --- 3. CORE MCP DISCOVERY HANDLERS ---

  // MCP Server Manifest (Required)
  handleManifest(req) {
    const mcpResourceId = this.getResourceId(req);
    return {
      statusCode: 200,
      body: JSON.stringify({
        name: 'DCR Validator MCP Server',
        description: 'A mock MCP server to validate Dynamic Client Registration (DCR) and OAuth 2.1 token exchange with an external Authorization Server.',
        version: '1.0',
        contact: 'support@example.com',
        tools_url: `${mcpResourceId}/tools`,
        prompts_url: `${mcpResourceId}/prompts`,
        streaming_url: `${mcpResourceId}/sse`,
        auth: {
          type: 'OAuth',
          authorization_server_url: AUTHORIZATION_SERVER_URL,
          scopes: SUPPORTED_SCOPES,
          resource_id: mcpResourceId
        }
      }),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  // MCP Tools Discovery
  handleTools() {
    // Tool definitions are static for this example
    return {
      statusCode: 200,
      body: JSON.stringify([
        {
          name: "get_secure_user_data",
          description: "A secure tool that retrieves user-specific information based on the validated token claims.",
          parameters: {
            type: "object",
            properties: {
              data_key: { type: "string", description: "The specific data field to retrieve (e.g., email, status)." }
            }
          }
        },
        {
          name: "calculate_payroll_tax",
          description: "Calculates estimated payroll tax based on annual salary and state of residence.",
          parameters: {
            type: "object",
            properties: {
              annual_salary: { type: "number", description: "The user's total annual salary." },
              state: { type: "string", description: "The state of residence (e.g., CA, NY)." }
            },
            required: ["annual_salary", "state"]
          }
        }
      ]),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  // MCP Prompts Discovery
  handlePrompts() {
    // Prompt definitions are static for this example
    return {
      statusCode: 200,
      body: JSON.stringify([
        {
          name: "generate_onboarding_summary",
          description: "Generates a personalized summary of the user's account details and next steps after successful token validation.",
          input_format: {
            type: "object",
            properties: {
              name: { type: "string", description: "The user's display name." }
            }
          }
        }
      ]),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  // --- 4. MCP RESOURCE SERVER ENDPOINT (Protocol Handler) ---

  // The main handler for the Model Context Protocol POST requests.
  handleMcp(req) {
    console.log('Incoming MCP Request Body:', req.body);
        
    const mcpResponse = {
      messages: [{
        type: "text",
        text: `MCP Acknowledged. Token successfully validated by the external AS (${this.authorizer.DISCOVERY_METADATA.issuer}). User ID: ${req.claims.sub}. You can now execute protected tools.`
      }],
      tool_calls: [{
        tool: "get_secure_user_data",
        arguments: { data_key: "email" }
      }]
    };
        
    return {
      statusCode: 200,
      body: JSON.stringify(mcpResponse),
      headers: { 'Content-Type': 'application/json' }
    };
  }

  // --- 5. SSE ENDPOINT (Streaming Protocol Handler) ---

  /**
     * Handles Server-Sent Events for long-running or streaming responses.
     */
  handleSse(req) {
    // NOTE: Server-Sent Events implementation for serverless is complex,
    // so this mimics the correct headers but provides a simplified, non-streaming response.
        
    console.log('Attempted SSE Connection. Returning mock streaming success.');

    const eventData = {
      id: Date.now(),
      status: 'completed',
      progress: 100,
      user: req.claims.sub,
      message: `Mock SSE task finished. Final result provided.`
    };

    const sseBody = `data: {"message": "SSE stream connected. Mocking full result now..."}\n\n`
                        + `data: ${JSON.stringify(eventData)}\n\n`;

    return {
      statusCode: 200,
      body: sseBody,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    };
  }
}
