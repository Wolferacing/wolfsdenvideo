# Deployment & Development Guide

This guide covers setting up a local development environment and deploying the application to a production service like Render.

## Local Development Setup

### Prerequisites

-   [Node.js](https://nodejs.org/) (v20.x or greater, as per `package.json`)
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

3.  **Configure the Host URL:**
    This is a critical step. The client-side scripts need to know the URL of your server.
    -   Open the file `public/config.js`.
    -   Change the `HOST_URL` to `localhost:3000` for local testing.
    ```javascript
    // public/config.js
    window.APP_CONFIG = {
      HOST_URL: 'localhost:3000' // For local development
    };
    ```

4.  **Set up the database:**
    -   Create a new database in your PostgreSQL instance.
    -   The application needs a database connection URL. You will set this as an environment variable.

5.  **Configure Environment Variable:**
    Create a file named `.env` in the root of the project. This file will store your local database connection string and is ignored by git.
    Add the following line to your `.env` file, replacing the values with your own:
    ```
    # .env file
    DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME"
    
    # Example for a local setup:
    # DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/firevplayer"
    ```

6.  **Run the server:**
    ```bash
    npm start
    ```
    The server will start, and you can access the application at `http://localhost:3000`. The server will automatically create the necessary `player_state` table in your database on its first run.

## Deployment to Render

This application is designed to be easily deployed on Render.

1.  **Fork this repository** to your own GitHub account.

2.  **Create a PostgreSQL Service on Render:**
    -   On your Render dashboard, click "New" -> "PostgreSQL".
    -   Give it a name and choose a region.
    -   **Note:** Render's free tier databases have a **fixed 90-day lifespan**. For a permanent free option, consider an external service like Neon or Supabase and get their connection URL.

3.  **Configure the Host URL before deploying:**
    Before you push your code to GitHub for Render to build, you must configure the application's public URL.
    -   Open the file `public/config.js`.
    -   Change the `HOST_URL` to your Render service's URL (e.g., `your-app-name.onrender.com`).
    ```javascript
    // public/config.js
    window.APP_CONFIG = {
      HOST_URL: 'your-app-name.onrender.com' // Your public Render URL
    };
    ```

4.  **Create the Web Service on Render:**
    -   On your Render dashboard, click "New" -> "Web Service".
    -   Connect the GitHub repository you forked.
    -   Configure the service:
        -   **Name:** `fire-v-player` (or your choice)
        -   **Region:** Choose the same region as your database for best performance.
        -   **Branch:** `main` (or your default branch)
        -   **Build Command:** `npm install`
        -   **Start Command:** `npm start`

5.  **Link the Environment Variable:**
    -   In your Web Service settings, go to the "Environment" tab.
    -   **If using Render's DB:** Click "Add Environment Group" and select the group associated with your PostgreSQL service. This will automatically create the `DATABASE_URL` variable.
    -   **If using an External DB:** Click "Add Environment Variable". Set the `Key` to `DATABASE_URL` and paste the connection URL from your external provider into the `Value` field.

6.  **Deploy:**
    -   Click "Create Web Service". Render will build and deploy your application. The first time it starts, it will connect to the database and set up the required table.

### Database Maintenance

The application includes an automatic cleanup job that runs every 24 hours. It purges any player instances from the database that have been inactive for more than 7 days, keeping your database lean and performant.