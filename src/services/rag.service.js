import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import {
  ChatGoogleGenerativeAI,
  GoogleGenerativeAIEmbeddings,
} from "@langchain/google-genai";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// ---- __dirname for ESM ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- MongoDB native client ----
let mongoClient = null;

const getMongoClient = async () => {
  if (!mongoClient) {
    mongoClient = new MongoClient(process.env.MONGODB_URI || "");
    await mongoClient.connect();
  }
  return mongoClient;
};

// ---- Google GenAI Embeddings ----
// gemini-embedding-001 → default 3072 dimensions (FREE, same API key as Gemini chat)
const getEmbeddings = () => {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY is not set in .env!");
  }
  return new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY,
    model: "gemini-embedding-001",
  });
};

// ---- Vector Store ----
const getVectorStore = async () => {
  const client = await getMongoClient();
  const collection = client.db("edureach_db").collection("knowledge_docs");

  return new MongoDBAtlasVectorSearch(getEmbeddings(), {
    collection: collection,
    indexName: "edureach_vector_index",
    textKey: "text",
    embeddingKey: "embedding",
  });
};

const ensureVectorIndex = async (collection, numDimensions) => {
  const indexes = await collection
    .listSearchIndexes("edureach_vector_index")
    .toArray();
  if (indexes.some((index) => index.queryable || index.status === "READY")) {
    return;
  }

  await collection.createSearchIndex({
    name: "edureach_vector_index",
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: "embedding",
          numDimensions,
          similarity: "cosine",
        },
      ],
    },
  });
  console.log(" Vector search index creation started.");
};

// ============================================
// A) INDEXING — runs ONCE at server startup
// ============================================
export const initializeKnowledgeBase = async () => {
  const client = await getMongoClient();
  const collection = client.db("edureach_db").collection("knowledge_docs");

  // Check if knowledge base is already indexed with valid embeddings
  const docWithEmbedding = await collection.findOne({
    embedding: { $exists: true, $not: { $size: 0 } },
  });

  if (docWithEmbedding) {
    await ensureVectorIndex(collection, docWithEmbedding.embedding.length);
    console.log(" Knowledge base already indexed — skipping.");
    return;
  }

  // Clean up any existing chunks with empty embeddings before re-indexing
  await collection.deleteMany({});

  console.log(" Indexing knowledge base...");

  // Verify API key FIRST with a test embedding
  const embeddings = getEmbeddings();
  try {
    const testResult = await embeddings.embedQuery("test");
    console.log(` API key OK — embedding dimensions: ${testResult.length}`);
  } catch (error) {
    console.error(" Embedding test failed!");
    console.error("   Error:", error.message || error);
    console.error("   Get key from: https://aistudio.google.com/apikey");
    throw error;
  }

  // LOAD
  const filePath = path.join(
    __dirname,
    "../../knowledge-base/edureach-knowledge.txt",
  );
  const loader = new TextLoader(filePath);
  const docs = await loader.load();
  if (docs.length === 0) {
    throw new Error("No documents found in knowledge base file");
  }
  const totalCharacters = docs.reduce(
    (sum, doc) => sum + doc.pageContent.length,
    0,
  );
  console.log(`    Loaded ${totalCharacters} characters`);

  // SPLIT
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const allSplits = await splitter.splitDocuments(docs);
  console.log(`    Split into ${allSplits.length} chunks`);

  // EMBED + STORE
  const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
    collection: collection,
    indexName: "edureach_vector_index",
    textKey: "text",
    embeddingKey: "embedding",
  });

  await vectorStore.addDocuments(allSplits);

  // VERIFY
  const verifyDoc = await collection.findOne({
    embedding: { $exists: true, $not: { $size: 0 } },
  });

  if (
    verifyDoc &&
    Array.isArray(verifyDoc.embedding) &&
    verifyDoc.embedding.length > 0
  ) {
    console.log(
      `    ${allSplits.length} chunks stored (${verifyDoc.embedding.length}D embeddings)`,
    );
    await ensureVectorIndex(collection, verifyDoc.embedding.length);
    console.log(
      `     IMPORTANT: Create Atlas Vector Search index with numDimensions: ${verifyDoc.embedding.length}`,
    );
  } else {
    await collection.deleteMany({});
    throw new Error(" Embeddings are empty! Google API returned no vectors.");
  }
};

// ============================================
// B) RAG RESPONSE — runs on every chat query
// ============================================
export const getRAGResponse = async (question) => {
  try {
    const vectorStore = await getVectorStore();
    const retrievedDocs = await vectorStore.similaritySearch(question, 3);

    if (retrievedDocs.length === 0) {
      return "I don't have that information right now. Please contact the college office for assistance.";
    }

    const context = retrievedDocs.map((doc) => doc.pageContent).join("\n\n");

    const model = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      temperature: 0.7,
      apiKey: process.env.GOOGLE_API_KEY,
    });

    const result = await model.invoke([
      {
        role: "system",
        content: `You are EduReach Bot. Answer based on this context:\n\n${context}`,
      },
      { role: "user", content: question },
    ]);

    return result.content;
  } catch (error) {
    console.error(`[RAG] EXCEPTION: ${error.message}`);
    return `I am having trouble accessing the knowledge base (${error.message}). Please check server logs and configuration.`;
  }
};

export const checkHealth = async () => {
  const status = {
    hasMongoUri: Boolean(process.env.MONGODB_URI),
    hasGoogleKey: Boolean(process.env.GOOGLE_API_KEY),
    mongo: "unknown",
    gemini: "unknown",
  };

  try {
    const client = await getMongoClient();
    await client.db("admin").command({ ping: 1 });
    status.mongo = "connected";
  } catch (err) {
    status.mongo = `failed: ${err.message}`;
  }

  try {
    const embeddings = getEmbeddings();
    await embeddings.embedQuery("ping");
    status.gemini = "working";
  } catch (err) {
    status.gemini = `failed: ${err.message}`;
  }

  return status;
};
