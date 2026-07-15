import { AuthForm } from "../AuthForm";
import { loginAction } from "../actions";

export default function LoginPage() {
  return <AuthForm mode="login" action={loginAction} />;
}
