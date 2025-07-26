'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    // The table name is 'player_state' to match existing queries.
    await queryInterface.createTable('player_state', {
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
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('player_state');
  }
};
