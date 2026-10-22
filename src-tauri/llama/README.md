llama.cpp's server, which runs EmbeddingGemma 2 inside WinFynd, goes in this folder
(llama-server.exe and its DLLs). `npm run build:installer` fetches the pinned build
(scripts/fetch-llama.mjs) before packaging; it's not committed.
