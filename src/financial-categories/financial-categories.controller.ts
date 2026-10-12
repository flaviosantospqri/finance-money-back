import { Body, Controller, Get, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CreateFinancialCategoryDto, UpdateFinancialCategoryDto } from './dto/financial-category.dto.js';
import { FinancialCategoriesService } from './financial-categories.service.js';

@Controller('financial-categories')
export class FinancialCategoriesController {
  constructor(private readonly categories: FinancialCategoriesService) {}

  @Get()
  findAll(
    @Query('active', new ParseBoolPipe({ optional: true })) active?: boolean,
    @Query('nature') nature?: 'income' | 'expense',
  ) {
    return this.categories.findAll(active, nature);
  }

  @Post()
  create(@Body() input: CreateFinancialCategoryDto) {
    return this.categories.create(input);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateFinancialCategoryDto) {
    return this.categories.update(id, input);
  }
}
