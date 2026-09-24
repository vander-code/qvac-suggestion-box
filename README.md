# Suggestion Box (QVAC)

Submit suggestions and browse everyone else's as sticky notes. Upvote the ones you agree with, mark them
done, filter by category and sort by votes or date.

An **on-device AI** makes the box smarter:

- **Duplicate spotting**: before a suggestion is submitted, similar existing ones are shown so people can upvote instead.
- **Auto-sorting**: each suggestion is filed as an Idea, Problem, Praise or Question (you can change it).
- **Search by meaning**: search "slow" and find "takes forever to load".

The AI runs **on your own computer** using [QVAC](https://github.com/tetherto/qvac), Tether's open-source
AI SDK. No API key, no cloud service, and the suggestions never leave your machine.

![screenshot](screenshot.png)

## SDK version

`@qvac/sdk` **0.19.0** (declared in `package.json`)

Functions used: `loadModel` and `embed`, with the `EMBEDDINGGEMMA_300M_Q4_0` embedding model.

## Install

You need [Node.js](https://nodejs.org) (current LTS) and a little free disk space for the model.

```bash
git clone https://github.com/YOUR-USERNAME/qvac-suggestion-box.git
cd qvac-suggestion-box
npm install
```

## Run

```bash
npm start
```

Then open **http://localhost:3011** in your browser (open that address, not the HTML file).

The first start downloads the model. The box works while it loads. Click **Add sample suggestions** to try it.

## How it works

- Suggestions are saved in `data/suggestions.json` on your computer. This folder is git-ignored so submissions never get uploaded.
- Each suggestion is turned into a list of numbers (an "embedding") with QVAC's `embed`. Similar meanings get similar numbers.
- **Duplicates**: a new suggestion is compared with the open ones. If the similarity is at least `SIMILAR_THRESHOLD` (top of `server.js`), it is shown as "may already be here". The server prints the score of the closest match, so you can tune the threshold.
- **Auto-sorting**: the four categories are described in one sentence each. A suggestion is filed under the category whose description is closest in meaning. This is a quick guess, which is why you can change it.
- **Search** ranks by meaning plus a small bonus for exact word matches, and hides results far weaker than the best one.
- The server listens on `127.0.0.1`, so only your own computer can reach it.

## License

MIT
