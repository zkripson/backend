/**
 * CORS utilities for adding headers to responses
 */

// CORS headers for cross-origin requests
export const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
	'Access-Control-Max-Age': '86400', // 24 hours
};

/**
 * Helper function to create a response with JSON content and CORS headers
 */
export function jsonResponse(data: any, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...corsHeaders,
		},
	});
}

/**
 * Helper function to create an error response with CORS headers
 */
export function errorResponse(message: string, status = 400): Response {
	return jsonResponse({ error: message }, status);
}

/**
 * Adds CORS headers to an existing response
 */
export function addCorsHeaders(response: Response): Response {
	const newResponse = new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});

	Object.entries(corsHeaders).forEach(([key, value]) => {
		newResponse.headers.set(key, value);
	});

	return newResponse;
}
