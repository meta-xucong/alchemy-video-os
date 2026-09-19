ALTER TABLE "shots" DROP CONSTRAINT "shots_selected_asset_id_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_workspace_project_selected_asset_fk" FOREIGN KEY ("workspace_id","project_id","selected_asset_id") REFERENCES "public"."assets"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;