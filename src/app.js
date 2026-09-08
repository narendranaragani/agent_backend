import express from "express";
import cors from "cors";
import chatRoutes from "./routes/chat.routes.js";
import errorHandler from "./middleware/error-handler.middleware.js";
import { checkHealth } from "./services/rag.service.js";

const app = express();

// Middleware
app.use(
  cors({
    origin: true, // Reflect request origin to allow any frontend (localhost, Vercel, Netlify, etc.)
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "10mb" }));

// Health Check
app.get("/", (req, res) => {
  res.status(200).json({ status: "active", message: "EduReach API is running" });
});

app.get("/api/health", async (req, res) => {
  try {
    const health = await checkHealth();
    res.status(200).json({ success: true, ...health });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Routes
app.use("/api/chat", chatRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

// Global error handler (must be last)
app.use(errorHandler);

export default app;

