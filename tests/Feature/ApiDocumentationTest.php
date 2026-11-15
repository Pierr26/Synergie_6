<?php

namespace Tests\Feature;

use Tests\TestCase;

class ApiDocumentationTest extends TestCase
{
    public function test_openapi_document_declares_actor_header_and_workspace_enum(): void
    {
        $document = $this->getJson(route('scramble.docs.document'))->assertOk()->json();

        $this->assertStringStartsWith('3.1.', $document['openapi']);
        $this->assertSame(
            ['type' => 'apiKey', 'in' => 'header', 'name' => 'X-Hexta-Actor'],
            array_intersect_key($document['components']['securitySchemes']['HextaActor'], array_flip(['type', 'in', 'name'])),
        );

        $console = $document['paths']['/v1/workspaces/{workspace}/console']['get'];
        $this->assertSame([[], ['HextaActor' => []]], $console['security']);

        $workspace = collect($console['parameters'])->firstWhere('name', 'workspace');
        $this->assertSame(['explore', 'demo'], $workspace['schema']['enum']);

        $this->assertArrayNotHasKey('security', $document['paths']['/v1/health']['get']);
    }

    public function test_swagger_ui_loads_the_generated_document(): void
    {
        $this->get(route('docs.swagger'))
            ->assertOk()
            ->assertSee('swagger-ui-dist@5.17.14', false)
            ->assertSee(json_encode(route('scramble.docs.document')), false);
    }

    public function test_docs_are_reachable_outside_local_only_when_public(): void
    {
        $this->app['env'] = 'production';

        config(['hexta.api_docs.public' => true]);
        $this->get(route('scramble.docs.ui'))->assertOk();
        $this->get(route('docs.swagger'))->assertOk();

        config(['hexta.api_docs.public' => false]);
        $this->get(route('scramble.docs.ui'))->assertForbidden();
        $this->get(route('docs.swagger'))->assertForbidden();
    }
}
