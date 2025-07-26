'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    // The table name is now 'player_states' to follow Sequelize conventions (plural).
    // If your table is already named 'player_state', you can keep it, but this is best practice.
    await queryInterface.createTable('player_states', {
      instanceId: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.STRING,
        field: 'instance_id' // Match the database column name
      },
      playerData: {
        type: Sequelize.JSONB, // Use JSONB for better performance and indexing capabilities
        field: 'player_data',
        allowNull: false
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('player_states');
  }
};
