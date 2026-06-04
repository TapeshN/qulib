// Fixture Cypress component spec. Named *.spec.tsx so the repo scanner's test glob
// picks it up, and its path under cypress/component → detected as `cypress-component`.
// Provides the component half of the component-test-ratio (1 e2e : 1 component → 50).
import { LoginForm } from '../../components/LoginForm';

describe('LoginForm', () => {
  it('mounts', () => {
    cy.mount(<LoginForm />);
    cy.get('[data-testid="submit"]').should('exist');
  });
});
