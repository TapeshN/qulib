// Fixture Cypress e2e spec. Path under cypress/e2e → detected as `cypress-e2e`.
// Provides the e2e half of the component-test-ratio (1 e2e : 1 component → 50).
describe('smoke', () => {
  it('loads the dashboard', () => {
    cy.visit('/dashboard');
    cy.get('.dashboard').should('be.visible');
  });
});
