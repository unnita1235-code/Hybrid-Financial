import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const decision = formData.get("decision");
  const authorizationId = formData.get("authorization_id");

  if (typeof authorizationId !== "string" || !authorizationId) {
    return badRequest("Missing authorization_id");
  }

  if (decision !== "approve" && decision !== "deny") {
    return badRequest("Invalid decision");
  }

  const supabase = await getSupabaseServerClient();

  if (decision === "approve") {
    const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId);
    if (error) {
      return badRequest(error.message);
    }
    if (!data?.redirect_url) {
      return badRequest("No redirect from authorization");
    }
    return NextResponse.redirect(data.redirect_url);
  }

  const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId);
  if (error) {
    return badRequest(error.message);
  }
  if (!data?.redirect_url) {
    return badRequest("No redirect from authorization");
  }
  return NextResponse.redirect(data.redirect_url);
}
