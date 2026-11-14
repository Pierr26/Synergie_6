<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('crew_cases', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->string('mission_id')->index();
            $table->string('kind');
            $table->string('status')->default('submitted');
            $table->json('data');
            $table->json('thread');
            $table->uuid('photo_id')->nullable();
            $table->string('photo_path')->nullable();
            $table->timestamps();
            $table->index(['mission_id', 'status', 'created_at']);
        });
        Schema::create('crew_reports', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('author_id')->constrained('users')->restrictOnDelete();
            $table->foreignId('crew_id')->constrained('users')->restrictOnDelete();
            $table->string('mission_id')->index();
            $table->json('snapshot');
            $table->string('status')->default('not-queued');
            $table->timestamp('queued_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('crew_reports');
        Schema::dropIfExists('crew_cases');
    }
};
