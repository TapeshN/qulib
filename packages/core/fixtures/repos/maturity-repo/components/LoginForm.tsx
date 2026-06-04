// Fixture interactive component WITH a stable data-testid → counts as scanned and NOT
// missing, so test-id-hygiene is applicable and scores 100 for this fixture.
export function LoginForm() {
  return (
    <form data-testid="login-form">
      <input data-testid="username" name="username" />
      <input data-testid="password" name="password" type="password" />
      <button data-testid="submit" type="submit">
        Sign in
      </button>
    </form>
  );
}
