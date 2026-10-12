import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { RepasseInputDto } from './dto/repasse.dto.js';
import { RepassesService } from './repasses.service.js';

@Controller('financial-repasses')
export class RepassesController {
  constructor(private readonly repasses: RepassesService) {}
  @Get() list() { return this.repasses.list(); }
  @Post() create(@Body() body: RepasseInputDto) { return this.repasses.create(body); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() body: RepasseInputDto) { return this.repasses.update(id, body); }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.repasses.remove(id); }
}
