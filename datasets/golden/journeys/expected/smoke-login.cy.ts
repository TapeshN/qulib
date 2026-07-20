// Imported from a Chrome DevTools Recorder flow ("Smoke login flow", 6 recorded step(s), 6 converted).
// qulib-generated — scenario: recorder-smoke-login-flow

describe("Smoke login flow @smoke @regression", () => {
  it("Imported from a Chrome DevTools Recorder flow (\"Smoke login flow\", 6 recorded step(s), 6 converted).", () => {
    cy.visit("/login");
    cy.get('body').should('be.visible');
    cy.get("aria/Email").type("reader@example.test");
    cy.get("aria/Password").type("correct-horse-battery");
    cy.get("aria/Sign in").click();
    cy.get("aria/Dashboard").should('be.visible');
  });
});
