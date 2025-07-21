const path = require('path');

// This configuration is for a local SQLite database using the pure JS LibSQL driver.
// It creates a `db.sqlite` file in your project's root directory.
const localSqliteConfig = {
  dialect: 'sqlite',
  storage: path.join(__dirname, '..', '..', 'db.sqlite'), // e.g. /path/to/project/db.sqlite
  dialectModule: require('@libsql/client') // Tell Sequelize to use the LibSQL driver
};

// This configuration is for a remote PostgreSQL/MySQL database via a connection URL.
const remoteDbConfig = {
    use_env_variable: "DATABASE_URL",
    dialect: "postgres", // Change to 'mysql' if using a MySQL DATABASE_URL
    dialectOptions: {
      ssl: { // Required for most cloud database providers
        require: true,
        rejectUnauthorized: false,
      },
	}
};

// Use the remote database config if DATABASE_URL is set in the environment.
// Otherwise, fall back to the simple, local SQLite setup.
const config = process.env.DATABASE_URL ? remoteDbConfig : localSqliteConfig;

module.exports = {
  development: config,
  test: config,
  production: config
}
