import serverless from "serverless-http";
import app from "./app.js";

// Hand our Express app to serverless-http once, when Lambda loads the code.
// (This runs on a cold start, then stays in memory for warm calls.)
const wrapped = serverless(app);

// This is the function Lambda will call for every request.
export const handler = async (event, context) => {
  // Keep cached MongoDB connections alive between calls.
  context.callbackWaitsForEmptyEventLoop = false;
  return wrapped(event, context);
};