const { Sequelize, DataTypes, Op } = require('sequelize');
const { Umzug, SequelizeStorage } = require('umzug');

// Helper to create a sequelize instance from a URL.
// It's defined here so it can be used by both the main connection and the one-time migrator.
const createSequelizeInstance = (dbUrl) => {
  if (!dbUrl) {
    return null;
  }
  const options = {
    logging: false, // Set to console.log for debugging
    // Recommended pool settings for a serverless/sleepy environment
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  };
  if (dbUrl.startsWith('postgres')) {
    options.dialect = 'postgres';
    options.dialectOptions = {
      ssl: { require: true, rejectUnauthorized: false },
      // This prevents Sequelize from running the slow "pg_timezone_names" query on connect.
      useUTC: false
    };
  } else if (dbUrl.startsWith('mysql')) {
    options.dialect = 'mysql';
  } else { // Assume sqlite file path
    options.dialect = 'sqlite';
    options.storage = dbUrl;
    options.dialectModule = require('@libsql/client');
  }
  return new Sequelize(dbUrl, options);
};

// --- Singleton Sequelize Instance ---
// Use the NEW_DATABASE_URL for the main connection if it exists, otherwise fall back to the old one.
// This ensures the app connects to the correct database after a potential migration.
const mainDbUrl = process.env.NEW_DATABASE_URL || process.env.DATABASE_URL;
const sequelize = createSequelizeInstance(mainDbUrl);

// --- Helper Functions ---
const applyRlsPolicy = async (tableName) => {
  if (!sequelize || sequelize.getDialect() !== 'postgres') return;
  try {
    console.log(`Applying RLS policy to "${tableName}" table for security...`);
    await sequelize.query(`ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;`);
    await sequelize.query(`DROP POLICY IF EXISTS "Deny All on ${tableName}" ON "${tableName}";`);
    await sequelize.query(`
      CREATE POLICY "Deny All on ${tableName}" ON "${tableName}"
      FOR ALL
      USING (false)
      WITH CHECK (false);
    `);
    console.log(`Successfully applied RLS policy to "${tableName}".`);
  } catch (rlsError) {
    if (rlsError.name === 'SequelizeDatabaseError' && rlsError.original.code === '42P01') { // 42P01 is undefined_table in Postgres
       console.warn(`"${tableName}" table not found, skipping RLS policy. It will be applied on next startup.`);
    } else {
      console.error(`!!! WARNING: Failed to apply RLS policy to "${tableName}" table. !!!`, rlsError.message);
    }
  }
};

const runMigrations = async () => {
  if (!sequelize) return;
  const umzug = new Umzug({
    migrations: { glob: 'server/migrations/*.js' },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: undefined,
  });
  await umzug.up();
  console.log('Migrations are up to date.');
};

const runOneTimeMigration = async () => {
    const oldDbUrl = process.env.DATABASE_URL;
    const newDbUrl = process.env.NEW_DATABASE_URL;

    if (!newDbUrl || !oldDbUrl || newDbUrl.trim() === '' || newDbUrl === oldDbUrl) {
        return; // No migration needed
    }

    console.log('!!! New database URL detected. Starting automated data migration. !!!');
    console.log(`Source:      ${oldDbUrl.substring(0, 40)}...`);
    console.log(`Destination: ${newDbUrl.substring(0, 40)}...`);

    const oldSequelize = createSequelizeInstance(oldDbUrl);
    if (!oldSequelize) {
        console.error('Could not create connection to the old database. Aborting migration.');
        return;
    }

    const PlayerStateModel = require('./models/playerState');
    const OldPlayerState = PlayerStateModel(oldSequelize, DataTypes);
    const NewPlayerState = PlayerStateModel(sequelize, DataTypes); // Use the main new sequelize instance

    console.log('Fetching all data from the source database...');
    const allStates = await OldPlayerState.findAll({ raw: true });
    console.log(`Found ${allStates.length} records to migrate.`);

    if (allStates.length > 0) {
        const transaction = await sequelize.transaction();
        try {
            console.log('Starting transaction on destination database...');
            await NewPlayerState.destroy({ where: {}, truncate: true, transaction });
            console.log('Destination table truncated.');
            await NewPlayerState.bulkCreate(allStates, { transaction });
            console.log('All records inserted into destination database.');
            await transaction.commit();
            console.log('Transaction committed.');
        } catch (err) {
            console.error('XXX DATABASE MIGRATION FAILED DURING TRANSACTION XXX');
            await transaction.rollback();
            console.error('Transaction has been rolled back.');
            throw err;
        }
    }
    await oldSequelize.close();
    console.log('✔✔✔ Data migration complete. Application will now use the new database. ✔✔✔');
};

const initializeDatabase = async () => {
  if (!sequelize) {
    console.warn('!!! WARNING: No database URL configured. !!!');
    console.warn('!!! Application will run in-memory only. No data will be saved. !!!');
    return { dbConnected: false };
  }

  try {
    // Run one-time data migration if needed. This must run before other DB operations.
    await runOneTimeMigration();

    // Now, initialize the main database connection.
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    await runMigrations();

    await applyRlsPolicy('SequelizeMeta');
    await applyRlsPolicy('player_state');

    return { dbConnected: true };

  } catch (dbError) {
    console.warn('!!! WARNING: Could not connect to the database. !!!');
    console.warn(`!!! Application will run in-memory only. No data will be saved. !!!`);
    console.warn('Database error:', dbError.message);
    return { dbConnected: false };
  }
};

module.exports = {
  sequelize,
  initializeDatabase,
};
