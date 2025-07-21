'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('player_state', {
      instance_id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.STRING
      },
      player_data: {
        type: Sequelize.JSON,
        allowNull: false
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('player_state');
  }
};
