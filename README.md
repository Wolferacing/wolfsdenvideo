# Fire-V-Player

A collaborative YouTube video player that allows users to create shared playlists, vote on songs, and watch together in real-time. This application is designed to be embedded in virtual worlds or used as a standalone web app.

It features a persistent state using a PostgreSQL database, making it suitable for platforms like Render where instances may sleep and restart.

## Features

-   Real-time synchronization of video playback.
-   Shared, persistent playlists.
-   Host controls (lock, skip, reorder).
-   "Take over" functionality for host role.
-   Voting system for song selection.
-   YouTube search and playlist import.

## Local Development Setup

### Prerequisites

-   [Node.js](https://nodejs.org/) (v20.x recommended, as per `package.json`)
-   npm
-   A running PostgreSQL instance (e.g., via local install or Docker).

### Steps

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/Fire-V-Player.git
    cd Fire-V-Player
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up the database:**
    -   Create a new database in your PostgreSQL instance.
    -   The application needs a database connection URL. You can set this as an environment variable.

4.  **Configure Environment Variable:**
    The application reads the database connection string from the `DATABASE_URL` environment variable.

    You can set this in your shell before running the app:
    ```bash
    export DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME"
    ```
    **Example for a local setup:**
    ```bash
    export DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/firevplayer"
    ```

5.  **Run the server:**
    ```bash
    npm start
    ```
    The server will start, and you can access the application at `http://localhost:3000`. The server will automatically create the necessary `player_state` table in your database on its first run.

## Deployment to Render

This application is designed to be easily deployed on Render.

1.  **Fork this repository** to your own GitHub account.

2.  **Create a PostgreSQL Service:**
    You have two main options for the database.

    **Option A: Render's Free PostgreSQL (for short-term projects)**
    -   On your Render dashboard, click "New" -> "PostgreSQL".
    -   Give it a name and choose a region.
    -   **Important:** Render's free tier databases have a **fixed 90-day lifespan** from the date of creation. They will be deleted after 90 days unless you upgrade to a paid plan. This is suitable for testing, demos, or short-term projects.

    **Option B: External Database (Recommended for long-term projects)**
    -   For a "forever free" option that won't be deleted, use a service like [Neon](https://neon.tech/), [Supabase](https://supabase.com/), or [ElephantSQL](https://www.elephantsql.com/).
    -   Sign up and create a new PostgreSQL project on their platform.
    -   They will provide you with a database connection URL (often called a connection string). Copy this URL.

3.  **Create a Web Service:**
    -   On your Render dashboard, click "New" -> "Web Service".
    -   Connect the GitHub repository you forked.
    -   Configure the service:
        -   **Name:** `fire-v-player` (or your choice)
        -   **Region:** Choose the same region as your database for best performance.
        -   **Branch:** `main` (or your default branch)
        -   **Build Command:** `npm install`
        -   **Start Command:** `npm start`

4.  **Link the Environment Variable:**
    -   In your Web Service settings, go to the "Environment" tab.
    -   **If using Render's DB (Option A):** Click "Add Environment Group" and select the group associated with your PostgreSQL service. This will automatically create the `DATABASE_URL` variable.
    -   **If using an External DB (Option B):** Click "Add Environment Variable". Set the `Key` to `DATABASE_URL` and paste the connection URL you copied from your external provider into the `Value` field.

5.  **Deploy:**
    -   Click "Create Web Service". Render will build and deploy your application. The first time it starts, it will connect to the database and set up the required table.

## License

This project uses code derived from A-Frame, which is under the MIT License. See LICENSE.md for more details.