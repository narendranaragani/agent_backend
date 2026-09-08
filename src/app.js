import express from "express";
import cors from "cors";
import chatRoutes from "./routes/chat.routes.js";
import errorHandler from "./middleware/error-handler.middleware.js";

const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
    methods: ["POST"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json({ limit: "10mb" }));

// Routes
app.use("/api/chat", chatRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

// Global error handler (must be last)
app.use(errorHandler);

export default app;

