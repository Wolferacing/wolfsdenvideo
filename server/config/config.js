const path = require('path');

function getDbConfig(dbUrl) {
  if (dbUrl) {
    // --- Remote Database Configuration ---
    const config = {
      use_env_variable: "DATABASE_URL",
    };

    if (dbUrl.startsWith('postgres')) {
      config.dialect = 'postgres';
      config.dialectOptions = { ssl: { require: true, rejectUnauthorized: false } };
    } else if (dbUrl.startsWith('mysql')) {
      config.dialect = 'mysql';
    }
    return config;
  } else {
    // --- Local SQLite Configuration ---
    return {
      dialect: 'sqlite',
      storage: path.join(__dirname, '..', '..', 'db.sqlite'),
      dialectModule: require('@libsql/client'),
    };
  }
}

const baseConfig = getDbConfig(process.env.DATABASE_URL);

module.exports = {
  development: {
    ...baseConfig,
    logging: console.log, // Log all queries in development
  },
  test: {
    ...baseConfig,
    logging: false, // Disable logging for tests
  },
  production: {
    ...baseConfig,
    logging: false, // Disable logging in production
  }
}
